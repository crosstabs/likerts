import {LikertsClient} from '../src';

declare const process: {env: Record<string, string | undefined>};

const base=process.env.LIKERTS_REHEARSAL_BASE_URL;
(base ? test : test.skip)('React Native client uses the real rehearsal backend',async()=>{
 const id=process.env.LIKERTS_REHEARSAL_COLLECTION_ID!;const token=process.env.LIKERTS_REHEARSAL_COLLECTION_TOKEN!;
 const client=new LikertsClient(base!,token);
 expect((await client.collection(id)).schema.title).toBe('Release rehearsal');
 const receipt=await client.submit(id,{idempotencyKey:'rel-react-native',answers:{comment:'react-native'},metadata:{sdk:'react-native'}});
 expect(receipt).toMatchObject({accepted:true,chargedCents:1});
});
