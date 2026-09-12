export const examples = {
  "pulse": {
    "schemaVersion": 1,
    "title": "A quick product pulse",
    "questions": [
      {
        "id": "rating",
        "type": "scale",
        "label": "How useful was this feature?",
        "required": true,
        "min": 1,
        "max": 5
      },
      {
        "id": "return",
        "type": "single_choice",
        "label": "Would you use it again?",
        "required": true,
        "options": [
          {
            "id": "yes",
            "label": "Yes"
          },
          {
            "id": "no",
            "label": "No"
          }
        ]
      },
      {
        "id": "improve",
        "type": "multiple_choice",
        "label": "What would you improve?",
        "options": [
          {
            "id": "speed",
            "label": "Speed"
          },
          {
            "id": "clarity",
            "label": "Clarity"
          },
          {
            "id": "features",
            "label": "Features"
          }
        ]
      },
      {
        "id": "comment",
        "type": "text",
        "label": "One thing we could do better (optional)",
        "maxLength": 200
      },
      {
        "id": "visits",
        "type": "number",
        "label": "How many times have you tried it? (optional)",
        "min": 0,
        "max": 100
      },
      {
        "id": "date",
        "type": "date",
        "label": "When did you first try it? (optional)"
      }
    ]
  },
  "conditional": {
    "schemaVersion": 3,
    "title": "Conditional checkout feedback",
    "questions": [
      {
        "id": "return",
        "type": "single_choice",
        "label": "Would you shop again?",
        "required": true,
        "options": [
          {
            "id": "yes",
            "label": "Yes"
          },
          {
            "id": "no",
            "label": "No"
          }
        ]
      },
      {
        "id": "reason",
        "type": "text",
        "label": "What went wrong?",
        "required": true,
        "maxLength": 500,
        "visibleWhen": {
          "questionId": "return",
          "operator": "equals",
          "value": "no"
        }
      },
      {
        "id": "improvements",
        "type": "multiple_choice",
        "label": "What should we improve?",
        "options": [
          {
            "id": "delivery",
            "label": "Delivery"
          },
          {
            "id": "payment",
            "label": "Payment"
          }
        ]
      },
      {
        "id": "deliveryDetails",
        "type": "text",
        "label": "Tell us about delivery",
        "maxLength": 500,
        "visibleWhen": {
          "questionId": "improvements",
          "operator": "includes",
          "value": "delivery"
        }
      },
      {
        "id": "contactDate",
        "type": "date",
        "label": "When may we contact you?",
        "visibleWhen": {
          "questionId": "reason",
          "operator": "answered"
        }
      }
    ]
  },
  "advanced": {
    "schemaVersion": 5,
    "title": "Product tradeoffs",
    "questions": [
      {
        "id": "priorities",
        "type": "ranking",
        "label": "Rank the priorities",
        "required": true,
        "options": [
          {
            "id": "quality",
            "label": "Quality"
          },
          {
            "id": "speed",
            "label": "Speed"
          },
          {
            "id": "price",
            "label": "Price"
          }
        ]
      },
      {
        "id": "experience",
        "type": "matrix",
        "label": "Rate each part of the experience",
        "required": true,
        "matrixMode": "single",
        "rows": [
          {
            "id": "service",
            "label": "Service"
          },
          {
            "id": "product",
            "label": "Product"
          }
        ],
        "columns": [
          {
            "id": "poor",
            "label": "Poor"
          },
          {
            "id": "good",
            "label": "Good"
          },
          {
            "id": "excellent",
            "label": "Excellent"
          }
        ]
      },
      {
        "id": "investment",
        "type": "constant_sum",
        "label": "Allocate 100 points",
        "required": true,
        "total": 100,
        "items": [
          {
            "id": "product",
            "label": "Product"
          },
          {
            "id": "support",
            "label": "Support"
          },
          {
            "id": "marketing",
            "label": "Marketing"
          }
        ]
      }
    ]
  },
  "branching": {
    "schemaVersion": 4,
    "title": "Visit follow-up",
    "questions": [
      {
        "id": "return",
        "type": "single_choice",
        "label": "Would you return?",
        "required": true,
        "options": [
          {
            "id": "yes",
            "label": "Yes"
          },
          {
            "id": "no",
            "label": "No"
          }
        ]
      },
      {
        "id": "highlight",
        "type": "text",
        "label": "What went well?",
        "required": true,
        "maxLength": 500
      },
      {
        "id": "problem",
        "type": "text",
        "label": "What should we fix?",
        "required": true,
        "maxLength": 500,
        "visibleWhen": {
          "questionId": "return",
          "operator": "equals",
          "value": "no"
        }
      },
      {
        "id": "followUp",
        "type": "single_choice",
        "label": "May we follow up?",
        "options": [
          {
            "id": "yes",
            "label": "Yes"
          },
          {
            "id": "no",
            "label": "No"
          }
        ]
      }
    ],
    "pages": [
      {
        "id": "experience",
        "title": "Your visit",
        "questionIds": [
          "return"
        ],
        "branches": [
          {
            "when": {
              "questionId": "return",
              "operator": "equals",
              "value": "no"
            },
            "goToPageId": "recovery"
          }
        ]
      },
      {
        "id": "praise",
        "title": "What worked",
        "questionIds": [
          "highlight"
        ],
        "branches": [
          {
            "when": {
              "questionId": "return",
              "operator": "equals",
              "value": "yes"
            },
            "goToPageId": "contact"
          }
        ]
      },
      {
        "id": "recovery",
        "title": "What to fix",
        "questionIds": [
          "problem"
        ]
      },
      {
        "id": "contact",
        "title": "Follow-up",
        "questionIds": [
          "followUp"
        ]
      }
    ]
  }
};
