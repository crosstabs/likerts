// Local test adapter only. Executes the exact REST command against real Redis.
import {createServer} from 'node:http';
import {createConnection} from 'node:net';
function parse(buffer,offset=0) {
 if(offset>=buffer.length)return;
 const end=buffer.indexOf('\r\n',offset);if(end<0)return;
 const text=buffer.subarray(offset+1,end).toString(),type=String.fromCharCode(buffer[offset]);let next=end+2;
 if(type===':')return [Number(text),next];
 if(type==='+')return [text,next];
 if(type==='-')throw new Error('redis_command_error');
 if(type==='$'){const n=Number(text);if(n===-1)return [null,next];if(buffer.length<next+n+2)return;return [buffer.subarray(next,next+n).toString(),next+n+2];}
 if(type==='*'){const values=[];for(let i=0;i<Number(text);i++){const reply=parse(buffer,next);if(!reply)return;values.push(reply[0]);next=reply[1];}return [values,next];}
 throw new Error('invalid_redis_reply');
}
export function redisCommand(port,command) {
 return new Promise((resolve,reject)=>{
  const socket=createConnection({host:'127.0.0.1',port});let data=Buffer.alloc(0),done=false;
  const finish=(error,value)=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve(value);};
  socket.setTimeout(1000,()=>finish(new Error('redis_fixture_timeout')));
  socket.on('error',()=>finish(new Error('redis_fixture_connection')));
  socket.on('connect',()=>{const pieces=[Buffer.from(`*${command.length}\r\n`)];for(const arg of command){const value=Buffer.from(String(arg));pieces.push(Buffer.from(`$${value.length}\r\n`),value,Buffer.from('\r\n'));}socket.write(Buffer.concat(pieces));});
  socket.on('data',chunk=>{data=Buffer.concat([data,chunk]);try{const reply=parse(data);if(reply)finish(null,reply[0]);}catch(error){finish(error);}});
 });
}
export async function createBridge(redisPort,token) {
 const state={mode:'normal',calls:0,redirected:0};
 const server=createServer(async(req,res)=>{
  if(req.url==='/redirect-target'){state.redirected++;res.writeHead(200);res.end('{"result":[1,0]}');return;}
  state.calls++;
  if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401);res.end();return;}
  if(state.mode==='timeout')return;
  if(state.mode==='redirect'){res.writeHead(302,{location:'/redirect-target'});res.end();return;}
  if(state.mode==='oversized'){res.writeHead(200,{'content-type':'application/json'});res.write(' '.repeat(3000));setTimeout(()=>res.end(' '.repeat(3000)),5);return;}
  if(state.mode==='denied'){res.writeHead(401);res.end('synthetic-upstream-secret-must-not-escape');return;}
  if(state.mode==='malformed'){res.writeHead(200);res.end('{"result":[1,99]}');return;}
  try {const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>64*1024)throw new Error('oversized');chunks.push(chunk);}const command=JSON.parse(Buffer.concat(chunks).toString());const result=await redisCommand(redisPort,command);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({result}));}
  catch {res.writeHead(500);res.end('{"error":"fixture_unavailable"}');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {state,url:`http://127.0.0.1:${server.address().port}`,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
