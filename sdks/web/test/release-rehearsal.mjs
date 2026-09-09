import assert from 'node:assert/strict';
import {LikertsClient} from '../dist/index.js';

const {LIKERTS_REHEARSAL_BASE_URL:base,LIKERTS_REHEARSAL_COLLECTION_ID:id,LIKERTS_REHEARSAL_COLLECTION_TOKEN:token}=process.env;
assert.ok(base&&id&&token,'rehearsal environment is required');
const client=new LikertsClient(base,token);
const collection=await client.collection(id);
assert.equal(collection.schema.title,'Release rehearsal');
const receipt=await client.submit(id,{idempotencyKey:'rel-web',answers:{comment:'web'},metadata:{sdk:'web'}});
assert.equal(receipt.accepted,true);assert.equal(receipt.chargedCents,1);
console.log('Web real-backend rehearsal passed');
