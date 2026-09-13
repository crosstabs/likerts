"""Local-only separate PostgreSQL + constrained released-binary supervisor check."""
import base64,datetime,hashlib,json,os,secrets,subprocess,time,urllib.request,urllib.error,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent
IMAGE='likerts-h06-supervisor:local';SOURCE='2996ebcbb9821cff67e0a6e8cae4722f0abf9e42'
run_id=secrets.token_hex(8);network='likerts-h06-'+run_id;pg=network+'-pg';web=network+'-web'
database='likerts_drill_'+run_id;workspace='hosted-drill-'+run_id
password=secrets.token_hex(24);runtime_password=secrets.token_hex(24);worker_password=secrets.token_hex(24)
admin=secrets.token_hex(32);token='lks_'+uuid.uuid4().hex;credential=str(uuid.uuid4());stage='prepare'
started_at=datetime.datetime.now(datetime.timezone.utc).isoformat()
created=[]
PRIVATE=ROOT/'.tools/h06-local-check';PRIVATE.mkdir(parents=True,exist_ok=True,mode=0o700);os.umask(0o077)
def run(args,stdin=None,env=None,timeout=60):
 result=subprocess.run(args,input=stdin,text=True,capture_output=True,env=env,timeout=timeout)
 if result.returncode:
  (PRIVATE/'command-error.txt').write_text(result.stderr)
  raise RuntimeError('local_command_failed')
 return result.stdout.strip()
def sql(query,owner='postgres',db='postgres'):
 return run(['docker','exec','-i',pg,'psql','-X','-qAt','-U',owner,'-d',db,'-v','ON_ERROR_STOP=1'],query)
def request(path,method='GET',value=None,credential=token,drill_auth=admin):
 headers={'x-likerts-drill-authorization':'Bearer '+drill_auth,'content-type':'application/json'}
 if credential is not None:headers['authorization']='Bearer '+credential
 req=urllib.request.Request(base+path,method=method,headers=headers,data=json.dumps(value).encode() if value is not None else None)
 try:
  with urllib.request.urlopen(req,timeout=20) as reply:return reply.status,json.loads(reply.read() or '{}')
 except urllib.error.HTTPError as error:return error.code,json.loads(error.read())
def accepted(path,method='GET',value=None,credential=token):
 status,data=request(path,method,value,credential);assert 200<=status<300,(stage,status);return data
try:
 stage='network';run(['docker','network','create',network]);created.append(('network',network))
 stage='postgres';env={**os.environ,'POSTGRES_PASSWORD':password}
 run(['docker','run','--pull=never','--rm','-d','--network',network,'--network-alias','postgres','--name',pg,'-e','POSTGRES_PASSWORD','postgres:16'],env=env);created.append(('container',pg))
 for _ in range(60):
  try:
   if sql('select 1')=='1':break
  except Exception:pass
  time.sleep(.25)
 else:raise RuntimeError('postgres_not_ready')
 stage='restricted_roles'
 sql(f"create role likerts_migrator login password '{password}' noinherit nobypassrls nocreatedb nocreaterole;create role likerts_runtime login password '{runtime_password}' noinherit nobypassrls nocreatedb nocreaterole;create role likerts_webhook_worker login password '{worker_password}' noinherit nobypassrls nocreatedb nocreaterole;create database {database} owner likerts_migrator;")
 owner_url=f'postgres://likerts_migrator:{password}@postgres:5432/{database}?sslmode=disable'
 stage='released_migrations';run(['docker','run','--rm','--network',network,'--platform','linux/amd64','--entrypoint','/usr/local/bin/likerts-migrate','-e','LIKERTS_MIGRATION_DATABASE_URL',IMAGE],env={**os.environ,'LIKERTS_MIGRATION_DATABASE_URL':owner_url},timeout=90)
 for path in ['backend/provision-runtime.sql','infrastructure/webhooks/provision-worker.sql']:
  code=run(['git','show',SOURCE+':'+path]);sql('\\set runtime_role likerts_runtime\n'+code,'likerts_migrator',database)
 stage='credential';sql(f"begin;select set_config('likerts.workspace_id','{workspace}',true);insert into likerts.workspaces(id) values('{workspace}');insert into likerts.service_credentials(workspace_id,id,name,token_hash,scopes,expires_at) values('{workspace}','{credential}','Local supervised fixture',decode('{hashlib.sha256(token.encode()).hexdigest()}','hex'),array['surveys:write','surveys:read','collections:write','collections:read','responses:read','exports:write','exports:read','webhooks:read','webhooks:write'],now()+interval '30 minutes');commit;",'likerts_migrator',database)
 stage='supervisor';fixture_env={
  'DATABASE_URL':f'postgres://likerts_runtime:{runtime_password}@postgres:5432/{database}?sslmode=disable',
  'LIKERTS_WEBHOOK_DATABASE_URL':f'postgres://likerts_webhook_worker:{worker_password}@postgres:5432/{database}?sslmode=disable',
  'LIKERTS_DRILL_DATABASE':database,'LIKERTS_DRILL_DATABASE_HOST':'postgres','LIKERTS_DRILL_LOCAL_TEST':'1','LIKERTS_DRILL_ADMIN_TOKEN':admin,
  'LIKERTS_COLLECTION_CREDENTIAL_KEY':base64.b64encode(secrets.token_bytes(32)).decode(),'LIKERTS_WEBHOOK_CREDENTIAL_KEY':base64.b64encode(secrets.token_bytes(32)).decode()}
 args=['docker','run','--rm','-d','--platform','linux/amd64','--network',network,'--name',web,'--memory','512m','--memory-swap','512m','--cpus','0.1','-p','127.0.0.1::10000']
 # Local emulation adapter is a read-only mount; hosted Dockerfile excludes it.
 args+=['--mount',f'type=bind,src={HERE}/local-emulation.mjs,dst=/opt/fixture/local-emulation.mjs,readonly','--entrypoint','node']
 for key in fixture_env:args+=['-e',key]
 run(args+[IMAGE,'/opt/fixture/local-emulation.mjs'],env={**os.environ,**fixture_env});created.append(('container',web))
 port=run(['docker','port',web,'10000/tcp']).rsplit(':',1)[1];base='http://127.0.0.1:'+port
 for _ in range(120):
  try:
   state=accepted('/drill/status')
   if all(child['live'] and child['identity'] for child in state['children'].values()) and request('/api/v1/surveys')[0]==200:break
  except Exception:pass
  time.sleep(.5)
 else:raise RuntimeError('fixture_not_ready')
 stage='authentication';assert request('/drill/status',drill_auth='wrong')[0]==401
 assert request('/api/v1/surveys',credential=None)[0]==401
 stage='first_response';fleet=json.loads((ROOT/'control-plane/public/docs/sdk-capabilities.json').read_text())
 survey=accepted('/api/v1/surveys','POST',{'idempotencyKey':run_id,'title':'Supervised test','questions':[{'id':'rating','type':'scale','label':'Rating','required':True,'min':1,'max':5}]})
 version=accepted(f"/api/v1/surveys/{survey['id']}/publish",'POST',{'revision':survey['revision'],'sdkCapabilities':fleet})
 collection=accepted('/api/v1/collections','POST',{'idempotencyKey':run_id,'surveyId':survey['id'],'version':version['version'],'placement':'drill','sdkCapabilities':fleet})
 submission={'idempotencyKey':run_id,'answers':{'rating':5},'metadata':{'channel':'isolated-local'}}
 path=f"/api/v1/collections/{collection['id']}/responses"
 receipt=accepted(path,'POST',submission,collection['token']);assert receipt==accepted(path,'POST',submission,collection['token'])
 stage='controlled_child_loss';before=accepted('/drill/status');identity=before['children']['worker']['identity']
 invalid={'target':'worker','bootId':before['bootId'],'generation':1,**identity,'pid':1}
 assert request('/drill/kill','POST',invalid)[0]==409
 for target in ['worker','api']:
  before=accepted('/drill/status');previous=before['children'][target]
  payload={'target':target,'bootId':before['bootId'],'generation':previous['generation'],**previous['identity']}
  assert request('/drill/kill','POST',payload)[0]==202
  for _ in range(80):
   after=accepted('/drill/status');child=after['children'][target]
   if child['generation']==2 and child['live'] and child['identity']:break
   time.sleep(.25)
  else:raise RuntimeError('replacement_missing')
  assert child['identity']['pid']!=previous['identity']['pid']
  assert any(event['target']==target and event['event']=='exit' and event['signal']=='SIGKILL' for event in after['events'])
  assert request('/drill/kill','POST',payload)[0]==409
 stage='restart_persistence'
 for _ in range(80):
  status,data=request('/api/v1/responses?limit=10')
  if status==200:break
  time.sleep(.25)
 assert status==200 and len(data['items'])==1 and data['items'][0]['receipt']==receipt
 stage='export';job=accepted('/api/v1/exports','POST',{'idempotencyKey':run_id,'format':'json','collectionId':collection['id']})
 for _ in range(80):
  job=accepted('/api/v1/exports/'+job['id'])
  if job['status']=='ready':break
  time.sleep(.25)
 assert job['status']=='ready' and job['responseCount']==1
 state=accepted('/drill/status');assert 0<state['memory']['peak']<512*1024*1024
 report={'passed':True,'startedAt':started_at,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':SOURCE,'releasedImage':'ghcr.io/crosstabs/likerts@sha256:40042f29d15f7fb18a1d95287b099fd94cf2185df3c637e3304d73764488ae7c','fixtureImageId':run(['docker','image','inspect',IMAGE,'--format','{{.Id}}']),'binaryHashes':{target:child['sha256'] for target,child in state['children'].items()},'memoryBytes':state['memory'],'webCpuLimit':0.1,'postgresVersion':16,'runtimeArchitecture':'amd64 under ARM64-host QEMU','identityBoundary':'local emulation adapter; native exact-executable guard tested separately','authenticatedServiceCredential':True,'anonymousApiDenied':True,'oneResponseIdempotentRetry':True,'apiAndWorkerSigkillReplacement':True,'responseSurvivedApiLoss':True,'oneResponseExportReady':True,'inFlightLeaseReclaimProven':False,'hostedProven':False}
 (HERE/'local-evidence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
except Exception as failure:
 (PRIVATE/'failure.txt').write_text(type(failure).__name__+': '+str(failure))
 logs=subprocess.run(['docker','logs',web],capture_output=True,text=True,timeout=5)
 (PRIVATE/'container-log.txt').write_text(logs.stdout+logs.stderr)
 print(json.dumps({'passed':False,'stage':stage,'error':'local_fixture_check_failed'}));raise SystemExit(1)
finally:
 for kind,name in reversed(created):
  subprocess.run(['docker',kind,'rm','-f',name] if kind=='container' else ['docker','network','rm',name],capture_output=True,timeout=30)
