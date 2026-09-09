//! Response-credit accounting. Adjustment methods are trusted operator APIs, not
//! customer management capabilities or proof that a processor payment occurred.
use crate::Error;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CreditKind {
    Grant,
    Purchase,
    Consumption,
    Refund,
    Reversal,
    Correction,
    ProviderAdjustment,
}
impl CreditKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Grant => "grant",
            Self::Purchase => "purchase",
            Self::Consumption => "consumption",
            Self::Refund => "refund",
            Self::Reversal => "reversal",
            Self::Correction => "correction",
            Self::ProviderAdjustment => "provider_adjustment",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreditAdjustment {
    pub idempotency_key: String,
    pub kind: CreditKind,
    pub promotional_delta: i64,
    pub paid_delta: i64,
    pub reference_id: Option<String>,
    pub reason_code: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreditEntry {
    pub id: String,
    pub adjustment: CreditAdjustment,
    pub response_id: Option<String>,
    pub created_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreditBalance {
    pub promotional_credits: u64,
    pub paid_credits: u64,
    pub paid_credit_debt: u64,
    pub available_credits: u64,
    pub promotional_responses: u64,
    pub paid_responses: u64,
    pub month_paid_responses: u64,
}
pub fn validate_adjustment(input: &CreditAdjustment) -> Result<(), Error> {
    let invalid = || Error::Invalid("invalid response-credit adjustment".into());
    if input.idempotency_key.trim().is_empty()
        || input.idempotency_key.chars().count() > 128
        || input.idempotency_key == "onboarding_v1"
        || input.idempotency_key.starts_with("response:")
        || input.promotional_delta.unsigned_abs() > 1_000_000_000
        || input.paid_delta.unsigned_abs() > 1_000_000_000
        || (input.promotional_delta == 0 && input.paid_delta == 0)
        || input.reason_code.is_empty()
        || input.reason_code.len() > 64
        || !input
            .reason_code
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
    {
        return Err(invalid());
    }
    if input
        .reference_id
        .as_ref()
        .is_some_and(|id| Uuid::parse_str(id).is_err())
    {
        return Err(invalid());
    }
    if input.reference_id.is_some()
        != matches!(
            input.kind,
            CreditKind::Refund | CreditKind::Reversal | CreditKind::ProviderAdjustment
        )
    {
        return Err(invalid());
    }
    match input.kind {
        CreditKind::Consumption => return Err(invalid()),
        CreditKind::ProviderAdjustment => return Err(invalid()),
        CreditKind::Grant if input.promotional_delta <= 0 || input.paid_delta != 0 => {
            return Err(invalid())
        }
        CreditKind::Purchase if input.paid_delta <= 0 || input.promotional_delta != 0 => {
            return Err(invalid())
        }
        CreditKind::Refund
            if input.paid_delta >= 0
                || input.promotional_delta != 0
                || input.reference_id.is_none() =>
        {
            return Err(invalid())
        }
        CreditKind::Reversal if input.reference_id.is_none() => return Err(invalid()),
        _ => {}
    }
    Ok(())
}
#[derive(Clone, Debug)]
pub struct CreditBook {
    pub(crate) entries: Vec<CreditEntry>,
}
impl Default for CreditBook {
    fn default() -> Self {
        Self {
            entries: vec![CreditEntry {
                id: Uuid::new_v4().to_string(),
                adjustment: CreditAdjustment {
                    idempotency_key: "onboarding_v1".into(),
                    kind: CreditKind::Grant,
                    promotional_delta: 1000,
                    paid_delta: 0,
                    reference_id: None,
                    reason_code: "onboarding".into(),
                },
                response_id: None,
                created_at: Utc::now(),
            }],
        }
    }
}
impl CreditBook {
    pub fn balance(&self) -> CreditBalance {
        let mut result = CreditBalance::default();
        let (mut promo, mut paid) = (0i64, 0i64);
        for e in &self.entries {
            promo += e.adjustment.promotional_delta;
            paid += e.adjustment.paid_delta;
            if e.adjustment.kind == CreditKind::Consumption {
                result.promotional_responses += (-e.adjustment.promotional_delta) as u64;
                result.paid_responses += (-e.adjustment.paid_delta) as u64;
                if e.created_at.format("%Y-%m").to_string()
                    == Utc::now().format("%Y-%m").to_string()
                {
                    result.month_paid_responses += (-e.adjustment.paid_delta) as u64;
                }
            }
        }
        result.promotional_credits = promo.max(0) as u64;
        result.paid_credits = paid.max(0) as u64;
        result.paid_credit_debt = (-paid).max(0) as u64;
        result.available_credits = if paid < 0 {
            0
        } else {
            (promo + paid).max(0) as u64
        };
        result
    }
    pub fn adjust(&mut self, input: CreditAdjustment) -> Result<CreditEntry, Error> {
        validate_adjustment(&input)?;
        if let Some(previous) = self
            .entries
            .iter()
            .find(|e| e.adjustment.idempotency_key == input.idempotency_key)
        {
            return if previous.adjustment == input {
                Ok(previous.clone())
            } else {
                Err(Error::Conflict)
            };
        }
        if matches!(input.kind, CreditKind::Refund | CreditKind::Reversal) {
            let original = self
                .entries
                .iter()
                .find(|e| Some(&e.id) == input.reference_id.as_ref())
                .ok_or(Error::NotFound)?;
            let prior: Vec<_> = self
                .entries
                .iter()
                .filter(|e| e.adjustment.reference_id == input.reference_id)
                .collect();
            let invalid = || Error::Invalid("invalid response-credit reference".into());
            if prior
                .iter()
                .any(|e| e.adjustment.kind == CreditKind::Reversal)
            {
                return Err(invalid());
            }
            if input.kind == CreditKind::Refund {
                let refunded: i64 = prior
                    .iter()
                    .filter(|e| e.adjustment.kind == CreditKind::Refund)
                    .map(|e| -e.adjustment.paid_delta)
                    .sum();
                if original.adjustment.kind != CreditKind::Purchase
                    || refunded - input.paid_delta > original.adjustment.paid_delta
                {
                    return Err(invalid());
                }
            } else if matches!(
                original.adjustment.kind,
                CreditKind::Refund | CreditKind::Reversal | CreditKind::Consumption
            ) || input.promotional_delta != -original.adjustment.promotional_delta
                || input.paid_delta != -original.adjustment.paid_delta
                || prior
                    .iter()
                    .any(|e| e.adjustment.kind == CreditKind::Refund)
            {
                return Err(invalid());
            }
        }
        let balance = self.balance();
        if balance.promotional_credits as i64 + input.promotional_delta < 0
            || balance.paid_credits as i64 + input.paid_delta < 0
        {
            return Err(Error::SpendLimit);
        }
        let entry = CreditEntry {
            id: Uuid::new_v4().to_string(),
            adjustment: input,
            response_id: None,
            created_at: Utc::now(),
        };
        self.entries.push(entry.clone());
        Ok(entry)
    }
    pub fn consume(&mut self, response_id: &str) -> Result<(), Error> {
        if self
            .entries
            .iter()
            .any(|e| e.response_id.as_deref() == Some(response_id))
        {
            return Ok(());
        }
        let b = self.balance();
        if b.available_credits == 0 {
            return Err(Error::SpendLimit);
        }
        self.entries.push(CreditEntry {
            id: Uuid::new_v4().to_string(),
            adjustment: CreditAdjustment {
                idempotency_key: format!("response:{response_id}"),
                kind: CreditKind::Consumption,
                promotional_delta: if b.promotional_credits > 0 { -1 } else { 0 },
                paid_delta: if b.promotional_credits > 0 { 0 } else { -1 },
                reference_id: None,
                reason_code: "accepted_response".into(),
            },
            response_id: Some(response_id.into()),
            created_at: Utc::now(),
        });
        Ok(())
    }
}
