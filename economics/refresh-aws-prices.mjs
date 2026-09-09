import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Exact regional SKUs avoid accidentally pricing Outposts, Windows, MRAP,
// Single-AZ storage or a different database engine. Refresh fails on ambiguity.
const definitions = {
  fargateArmVcpuHour: ['AmazonECS','SFSC5A7DP37FRTNX'],
  fargateArmGbHour: ['AmazonECS','U4BJMTG9K96ZW3HA'],
  rdsT4gMediumMultiAzHour: ['AmazonRDS','3G8THFFBJ944M2HP'],
  rdsGp3MultiAzGbMonth: ['AmazonRDS','BGF4DVRTWCBBXHUW'],
  rdsExcessBackupGbMonth: ['AmazonRDS','9XF3U4K57MG3MUFQ'],
  albHour: ['AWSELB','UXD3JNG6UAM79CW6'],
  albLcuHour: ['AWSELB','45KY3J5YX2QM6KS7'],
  s3StandardGbMonth: ['AmazonS3','M6MTARCQFUQBQ2V3'],
  s3PutRequest: ['AmazonS3','VHRJWKRHEA6VHEFY'],
  s3GetRequest: ['AmazonS3','T469UNPYX78434EG'],
  natGatewayHour: ['AmazonEC2','98TA3WPUP3A4AH4Y'],
  natGatewayGb: ['AmazonEC2','E9U985ZGMWKXKT47'],
  publicIpv4Hour: ['AmazonVPC','C8D8VMQRDHMB9KRU'],
  internetEgressGb: ['AWSDataTransfer','SDHP4R7WGBVJPQPY'],
  logIngestGb: ['AmazonCloudWatch','ZEKCE7VGMSM5XZPW'],
  logStoredGbMonth: ['AmazonCloudWatch','RKCBFFXUWXG8KUQY'],
  secretMonth: ['AWSSecretsManager','J5PMSXRJZ3HNHFEV'],
  secretApiRequest: ['AWSSecretsManager','KAUJ7G87ND7HD8N8'],
};
const documents = new Map();
const region = 'ap-southeast-1';
for (const service of new Set(Object.values(definitions).map(([service]) => service))) {
  const url = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${service}/current/${region}/index.json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  assert.ok(response.ok, `${service}: HTTP ${response.status}`);
  documents.set(service, { url, document: await response.json() });
}
const rates = {};
for (const [name,[service,sku]] of Object.entries(definitions)) {
  const { url, document } = documents.get(service);
  const product = document.products[sku];
  assert.ok(product, `missing ${name} SKU ${sku}; review selection`);
  assert.equal(product.attributes.regionCode ?? product.attributes.fromRegionCode, region);
  const terms = Object.values(document.terms.OnDemand[sku]);
  assert.equal(terms.length, 1, `${name}: ambiguous offer`);
  const dimensions = Object.values(terms[0].priceDimensions).filter(d => d.beginRange === '0');
  assert.equal(dimensions.length, 1, `${name}: ambiguous first-tier rate`);
  const dimension = dimensions[0];
  rates[name] = {
    usdPerUnit: Number(dimension.pricePerUnit.USD), unit: dimension.unit,
    description: dimension.description, sku, rateCode: dimension.rateCode,
    beginRange: dimension.beginRange, endRange: dimension.endRange,
    effectiveDate: terms[0].effectiveDate, publicationDate: document.publicationDate,
    source: url, attributes: product.attributes,
  };
}
const result = { retrievedAt: new Date().toISOString(), region, currency: 'USD', pricing: 'Public on-demand, first paid tier; excludes tax, credits and negotiated discounts', rates };
await writeFile(new URL('./aws-prices.json', import.meta.url), `${JSON.stringify(result,null,2)}\n`);
console.log(`Saved ${Object.keys(rates).length} sourced regional AWS rates`);
