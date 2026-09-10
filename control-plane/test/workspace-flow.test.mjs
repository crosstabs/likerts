import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as state from "../public/workspace-state.js";
const html = await readFile(new URL("../public/app/index.html", import.meta.url), "utf8");
const source = (await readFile(new URL("../public/app.js", import.meta.url), "utf8")).replace(/^import .*;\n/, "").replace('"__CLERK_PUBLISHABLE_KEY__"', JSON.stringify(`pk_test_${Buffer.from("safe.clerk.accounts.dev$").toString("base64url")}`)).replace('"__LIKERTS_PUBLIC_API_ORIGIN__"', '"https://api.example.com"');
const usage = {acceptedResponses: 901, blockedReason: null, credits: {promotionalCredits: 99, promotionalResponses: 901, paidCredits: 500, paidResponses: 0, paidCreditDebt: 0, availableCredits: 599}};
async function until(check) { for (let i=0;i<100;i++) { if (check()) return; await new Promise(r=>setTimeout(r,5)); } assert.ok(check(), "UI condition did not settle"); }
async function fixture({query = "", purchaseStatus = "paid", revokeFails = false, signedIn = true, checkoutFailsOnce = false} = {}) {
  const dom = new JSDOM(html, {url: `https://likerts.test/app${query}`, runScripts: "outside-only"});
  const {window} = dom; const requests = []; let listener; let checkoutAttempts=0; let credentials = [{id:"cred-1",name:"Existing",scopes:["usage:read"],expiresAt:"2027-01-01T00:00:00Z",revoked:false}];
  Object.assign(window, state);
  window.setTimeout = (fn,ms) => setTimeout(fn,Math.min(ms,5));
  Object.defineProperty(window.navigator,"clipboard",{value:{writeText: async()=>{throw new Error("denied");}}});
  const clerk = {session: signedIn ? {id:"session-1",getToken:async()=>"test-session"} : null, load: async options=>{clerk.options=options;}, addListener: fn=>{listener=fn;}, mountSignIn:(el,options)=>{clerk.signInOptions=options;el.textContent="Email code sign-in";},mountUserButton:el=>{el.textContent="Account";}};
  window.Clerk = clerk;
  const append = window.document.head.appendChild.bind(window.document.head);
  window.document.head.appendChild = node=>{const result=append(node);if(node.tagName==="SCRIPT") queueMicrotask(()=>node.onload());return result;};
  window.fetch = async (url, options = {}) => {
    requests.push({url,options}); let body; let status=200;
    if(url.endsWith("/bootstrap")) body={workspaceId:"ws_test",usage,paymentMode:"test"};
    else if(url.includes("/billing/checkouts/")) body={id:"11111111-1111-4111-8111-111111111111",status:Array.isArray(purchaseStatus) ? (purchaseStatus.length>1 ? purchaseStatus.shift() : purchaseStatus[0]) : purchaseStatus,responseCredits:500,checkoutUrl:null};
    else if(url.endsWith("/billing/checkout")) {checkoutAttempts++;if(checkoutFailsOnce && checkoutAttempts===1){status=503;body={};}else body={id:"11111111-1111-4111-8111-111111111111",status:"paid",responseCredits:500,checkoutUrl:null};}
    else if(options.method==="DELETE") {if(revokeFails){status=503;body={};} else {credentials=[];status=204;}}
    else if(options.method==="POST" && url.endsWith("/service-credentials")) {const input=JSON.parse(options.body);const credential={id:"cred-2",name:input.name,scopes:input.scopes,expiresAt:input.expiresAt,revoked:false};credentials.push(credential);body={credential,token:"test-only-issued-secret"};status=201;}
    else if(url.endsWith("/service-credentials")) body=credentials;
    else throw new Error(`Unexpected fetch ${url}`);
    return {ok:status<400,status,json:async()=>body};
  };
  window.eval(source);
  await until(()=> signedIn ? window.document.getElementById("workspace-content").hidden===false : clerk.signInOptions);
  return {window,clerk,requests,close:()=>dom.window.close(),changeSession:()=>listener()};
}
test("fresh signed-in workspace renders real counts and scoped tool setup", async()=>{
  const f=await fixture();try{const $=id=>f.window.document.getElementById(id);assert.equal($("response-status").textContent,"901");assert.equal($("promo-status").textContent,"99");assert.equal($("paid-status").textContent,"500");assert.match($("billing-mode").textContent,/Sandbox/);assert.match($("connection-code").textContent,/ws_test/);assert.equal(f.clerk.options.signInForceRedirectUrl,"/app");assert.equal($("scope-preset").value,"read");assert.equal(f.window.document.querySelector('[value="responses:write"]').checked,false);}finally{f.close();}
});
test("success query cannot confirm payment; paid server record can",async()=>{
  const missing=await fixture({query:"?checkout=success"});try{await until(()=>missing.window.document.getElementById("checkout-status").textContent.includes("not been confirmed"));assert.equal(missing.requests.some(r=>r.url.includes("/checkouts/")),false);}finally{missing.close();}
  const paid=await fixture({query:"?checkout=success&purchase_id=11111111-1111-4111-8111-111111111111"});try{await until(()=>paid.window.document.getElementById("checkout-status").textContent.includes("confirmed by Likerts"));assert.ok(paid.requests.some(r=>r.url.includes("/checkouts/")));}finally{paid.close();}
});
test("cancelled navigation with pending server record does not assert paid or failure",async()=>{
  const f=await fixture({query:"?checkout=cancelled&purchase_id=11111111-1111-4111-8111-111111111111",purchaseStatus:"open"});try{await until(()=>f.window.document.getElementById("checkout-status").textContent.includes("You left checkout"));assert.equal(f.window.document.getElementById("checkout-status").dataset.state,"pending");assert.equal(f.window.document.getElementById("check-payment").disabled,false);}finally{f.close();}
});
test("failed revoke is recoverable and sign-out clears issued secrets and workspace",async()=>{
  const f=await fixture({revokeFails:true});try{await until(()=>f.window.document.querySelector('[aria-label="Revoke Existing"]'));const revoke=f.window.document.querySelector('[aria-label="Revoke Existing"]');revoke.click();await until(()=>f.window.document.getElementById("credential-list-status").textContent.includes("not confirmed"));assert.equal(revoke.disabled,false);f.window.document.getElementById("agent-credential").dispatchEvent(new f.window.Event("submit",{cancelable:true}));await until(()=>!f.window.document.getElementById("agent-secret").hidden);f.window.document.getElementById("copy-agent-token").click();await until(()=>f.window.document.getElementById("agent-status").textContent.includes("manually"));f.clerk.session=null;f.changeSession();await until(()=>f.window.document.getElementById("workspace-content").hidden);assert.equal(f.window.document.getElementById("agent-token").value,"");assert.equal(f.clerk.signInOptions.forceRedirectUrl,"/app");}finally{f.close();}
});
test("sign-in listener opens workspace without manual reload",async()=>{
  const f=await fixture({signedIn:false});try{f.clerk.session={id:"new-session",getToken:async()=>"test"};f.changeSession();await until(()=>!f.window.document.getElementById("workspace-content").hidden);assert.equal(f.window.document.getElementById("workspace-status").textContent,"ws_test");}finally{f.close();}
});


test("pending webhook is polled and a confirmed purchase refreshes usage",async()=>{
  const f=await fixture({query:"?checkout=success&purchase_id=11111111-1111-4111-8111-111111111111",purchaseStatus:["pending","open","paid"]});try{await until(()=>f.window.document.getElementById("checkout-status").textContent.includes("confirmed by Likerts"));assert.equal(f.requests.filter(r=>r.url.includes("/checkouts/")).length,3);await until(()=>f.requests.filter(r=>r.url.endsWith("/bootstrap")).length===2);}finally{f.close();}
});
test("checkout failure retries the same request and a new purchase gets a new key",async()=>{
  const f=await fixture({checkoutFailsOnce:true});try{const submit=()=>f.window.document.getElementById("credit-checkout").dispatchEvent(new f.window.Event("submit",{cancelable:true}));submit();await until(()=>f.window.document.getElementById("checkout-status").textContent.includes("could not be opened"));submit();await until(()=>f.window.document.getElementById("checkout-status").textContent.includes("confirmed by Likerts"));const requests=f.requests.filter(r=>r.url.endsWith("/billing/checkout"));assert.equal(JSON.parse(requests[0].options.body).idempotencyKey,JSON.parse(requests[1].options.body).idempotencyKey);f.window.document.getElementById("new-payment").click();submit();await until(()=>f.requests.filter(r=>r.url.endsWith("/billing/checkout")).length===3);const latest=f.requests.filter(r=>r.url.endsWith("/billing/checkout"))[2];assert.notEqual(JSON.parse(latest.options.body).idempotencyKey,JSON.parse(requests[1].options.body).idempotencyKey);}finally{f.close();}
});
