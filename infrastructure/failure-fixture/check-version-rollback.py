"""Local released 0.1.1 -> 0.1.2 -> 0.1.1 compatibility; no provider calls.

Run from the repository with Docker available. Uses unique owned resources,
loopback HTTP, fresh secrets and one persistent isolated PostgreSQL container.
On ARM hosts the explicitly mounted emulation adapter is local-only.
"""
import base64, datetime, hashlib, json, os, platform, secrets, subprocess, time, urllib.error, urllib.request, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
RELEASES = {
    '0.1.1': {'source': 'a9f8b95b9f345129d91d961bee1070ad7f92e9e3', 'digest': '9b9662f9fd085bce4172f0526a4a4ef74a32243c1cfc14ca462416c962231900',
              'api': '12a4c2a47c8be8a6d2f51263eff33b82c449ab8ce7e87684d9afb82fd279bd77', 'worker': 'a965b455c0730679c239c8578aadfae44bfc6e3a847198ec396a350bc38fcccb'},
    '0.1.2': {'source': '2996ebcbb9821cff67e0a6e8cae4722f0abf9e42', 'digest': '40042f29d15f7fb18a1d95287b099fd94cf2185df3c637e3304d73764488ae7c',
              'api': '7a44648d0245119ceb4c9b7754a52f181aa6e1ff6420992135e005533f01afd6', 'worker': '136e387a55769eee12fe88c90e8cd0245b5dc2b124a1d99dd24244169368d4b6'},
}
os.umask(0o077)
run_id = secrets.token_hex(8)
prefix = 'likerts-rollback-' + run_id
network, pg, web = prefix, prefix+'-pg', prefix+'-web'
database, workspace = 'likerts_drill_'+run_id, 'hosted-drill-'+run_id
private = ROOT / '.tools' / prefix
private.mkdir(parents=True, mode=0o700)
password, runtime_password, worker_password = (secrets.token_hex(24) for _ in range(3))
admin, token, denied_token = secrets.token_hex(32), 'lks_'+uuid.uuid4().hex, 'lks_'+uuid.uuid4().hex
credential, denied_id = str(uuid.uuid4()), str(uuid.uuid4())
emulated = platform.machine().lower() in ('arm64', 'aarch64')
stage, base, created, built, observations = 'prepare', None, [], [], []
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
report = None

def run(args, body=None, env=None, timeout=90):
    result = subprocess.run(args, input=body, cwd=ROOT, text=True, capture_output=True, env=env, timeout=timeout)
    if result.returncode:
        (private/'command-error.txt').write_text(result.stderr)
        raise RuntimeError('local_command_failed')
    return result.stdout.strip()

def sql(query, owner='likerts_migrator', db=None):
    # TCP readiness excludes the image entrypoint's temporary Unix-socket server.
    return run(['docker','exec','-i','-e','PGPASSWORD',pg,'psql','-h','127.0.0.1','-X','-qAt','-U',owner,'-d',db or database,'-v','ON_ERROR_STOP=1'], query,
               env={**os.environ,'PGPASSWORD':password})

def tenant_sql(query):
    raw = sql(f"begin;set local statement_timeout='5s';select set_config('likerts.workspace_id','{workspace}',true);"+query+';commit;')
    return [json.loads(line) for line in raw.splitlines() if line.startswith('{')]

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

def request(path, method='GET', value=None, auth=token, supervisor_auth=admin):
    headers = {'content-type':'application/json', 'x-likerts-drill-authorization':'Bearer '+supervisor_auth}
    if auth is not None: headers['authorization'] = 'Bearer '+auth
    req = urllib.request.Request(base+path, method=method, headers=headers, data=None if value is None else json.dumps(value).encode())
    try:
        with opener.open(req, timeout=20) as reply:
            raw = reply.read(1048577); assert len(raw)<=1048576
            return reply.status, json.loads(raw or '{}')
    except urllib.error.HTTPError as error:
        return error.code, None

def accepted(path, method='GET', value=None, auth=token):
    status, data = request(path, method, value, auth)
    assert 200<=status<300, (stage, status)
    return data

def schema():
    return sql("select jsonb_build_object('versions',jsonb_agg(version order by version),'checksums',jsonb_agg(encode(checksum,'hex') order by version),'allSuccessful',bool_and(success)) from _sqlx_migrations")

def start_web(version):
    global base
    if ('container',web) in created:
        run(['docker','stop','--time','30',web], timeout=45)
        created.remove(('container',web))
    env = {
        'DATABASE_URL':f'postgres://likerts_runtime:{runtime_password}@postgres:5432/{database}?sslmode=disable',
        'LIKERTS_WEBHOOK_DATABASE_URL':f'postgres://likerts_webhook_worker:{worker_password}@postgres:5432/{database}?sslmode=disable',
        'LIKERTS_DRILL_DATABASE':database, 'LIKERTS_DRILL_DATABASE_HOST':'postgres', 'LIKERTS_DRILL_LOCAL_TEST':'1',
        'LIKERTS_DRILL_ADMIN_TOKEN':admin, **crypto_keys,
    }
    args = ['docker','run','--rm','--pull=never','-d','--platform','linux/amd64','--network',network,'--name',web,
            '--memory','512m','--memory-swap','512m','--cpus','0.1','-p','127.0.0.1::10000']
    if emulated:
        args += ['--mount',f'type=bind,src={HERE}/local-emulation.mjs,dst=/opt/fixture/local-emulation.mjs,readonly','--entrypoint','node']
    for key in env: args += ['-e',key]
    args += [images[version]]
    if emulated: args += ['/opt/fixture/local-emulation.mjs']
    run(args, env={**os.environ,**env}); created.append(('container',web))
    base = 'http://127.0.0.1:'+run(['docker','port',web,'10000/tcp']).rsplit(':',1)[1]
    for _ in range(120):
        try:
            state = accepted('/drill/status')
            if all(child['live'] and child['identity'] for child in state['children'].values()) and request('/api/v1/surveys')[0]==200: break
        except Exception: pass
        time.sleep(.5)
    else: raise RuntimeError('fixture_not_ready')
    assert request('/drill/status',supervisor_auth='wrong')[0]==401
    assert request('/api/v1/surveys',auth=None)[0]==401
    assert schema()==initial_schema
    assert all(state['children'][target]['sha256']==RELEASES[version][target] for target in ['api','worker'])
    assert all(item['generation']==1 and not item['killRequested'] for item in state['children'].values())
    assert all(state['bootId']!=old['bootId'] for old in observations)
    observations.append({'version':version,'bootId':state['bootId'],'hashes':{key:state['children'][key]['sha256'] for key in ['api','worker']}})

def responses(receipts):
    items = accepted('/api/v1/responses?limit=10')['items']
    assert len(items)==len(receipts)
    assert sorted(json.dumps(item['receipt'],sort_keys=True) for item in items)==sorted(json.dumps(item,sort_keys=True) for item in receipts)

def submit(index):
    submission = {'idempotencyKey':run_id+'-'+str(index),'answers':{'rating':index+1},'metadata':{'channel':'local-version-rollback'}}
    receipt = accepted(response_path,'POST',submission,collection['token'])
    assert accepted(response_path,'POST',submission,collection['token'])==receipt
    return submission, receipt

def export(name, receipts):
    job = accepted('/api/v1/exports','POST',{'idempotencyKey':run_id+'-'+name,'format':'json','collectionId':collection['id']})
    for _ in range(80):
        job = accepted('/api/v1/exports/'+job['id'])
        if job['status']=='ready': break
        assert job['status'] in ['queued','running']; time.sleep(.25)
    assert job['status']=='ready' and job['responseCount']==len(receipts)
    download = accepted('/api/v1/exports/'+job['id']+'/download')
    raw = base64.b64decode(download['contentBase64'],validate=True)
    assert hashlib.sha256(raw).hexdigest()==download['contentSha256']==job['contentSha256']
    assert download['manifest']['responseCount']==len(receipts)
    exported = json.loads(raw)['responses']
    assert sorted(json.dumps(item['receipt'],sort_keys=True) for item in exported)==sorted(json.dumps(item,sort_keys=True) for item in receipts)
    assert sorted(item['answers']['rating'] for item in exported)==list(range(1,len(receipts)+1))
    stored = tenant_sql(f"select jsonb_build_object('sha256',content_sha256,'count',response_count,'status',status) from likerts.export_jobs where workspace_id='{workspace}' and id='{job['id']}'")
    assert stored==[{'sha256':job['contentSha256'],'count':len(receipts),'status':'ready'}]
    assert request('/api/v1/exports/'+job['id']+'/download',auth=None)[0]==401
    return job

def revocation_snapshot(identifier):
    rows = tenant_sql(f"select jsonb_build_object('eventId',d.id,'body',o.body,'bodyHash',o.body_hash,'validHash',o.body_hash=encode(sha256(convert_to(o.body,'UTF8')),'hex')) from likerts.deletion_events d join likerts.erasure_archive_outbox o on o.event_id=d.id where d.workspace_id='{workspace}' and d.kind='export' and d.resource_id='{identifier}'")
    assert len(rows)==1 and rows[0]['validHash']
    return rows[0]

try:
    stage = 'release_provenance_and_build'
    images = {}
    # Historical schema and grants must be byte-identical before this compatibility check.
    scopes = ['backend/migrations','backend/provision-runtime.sql','infrastructure/webhooks/provision-worker.sql']
    assert not run(['git','diff','--name-only',RELEASES['0.1.1']['source'],RELEASES['0.1.2']['source'],'--',*scopes])
    for version, release in RELEASES.items():
        released = 'ghcr.io/crosstabs/likerts@sha256:'+release['digest']
        run(['docker','pull','--platform','linux/amd64',released], timeout=180)
        metadata = json.loads(run(['docker','image','inspect',released]))[0]
        labels = metadata['Config']['Labels']
        assert labels['org.opencontainers.image.revision']==release['source']
        assert labels['org.opencontainers.image.version']=='community-v'+version
        assert labels['org.opencontainers.image.source']=='https://github.com/crosstabs/likerts'
        actual = run(['docker','run','--rm','--platform','linux/amd64','--entrypoint','sha256sum',released,
                      '/usr/local/bin/likerts-server','/usr/local/bin/likerts-webhook-worker'])
        assert [line.split()[0] for line in actual.splitlines()]==[release['api'],release['worker']]
        image = prefix+':'+version; images[version]=image
        dockerfile = HERE/('Dockerfile.runtime-0.1.1' if version=='0.1.1' else 'Dockerfile')
        run(['docker','build','--platform','linux/amd64','-t',image,'-f',str(dockerfile),str(HERE)], timeout=240)
        built.append(image)
    stage = 'isolated_database'
    run(['docker','network','create',network]); created.append(('network',network))
    run(['docker','run','--rm','--pull=never','-d','--network',network,'--network-alias','postgres','--name',pg,'-e','POSTGRES_PASSWORD','postgres:16'],env={**os.environ,'POSTGRES_PASSWORD':password})
    created.append(('container',pg))
    for _ in range(60):
        try:
            if sql('select 1','postgres','postgres')=='1': break
        except Exception: pass
        time.sleep(.25)
    else: raise RuntimeError('postgres_not_ready')
    sql(f"create role likerts_migrator login password '{password}' noinherit nobypassrls nocreatedb nocreaterole;create role likerts_runtime login password '{runtime_password}' noinherit nobypassrls nocreatedb nocreaterole;create role likerts_webhook_worker login password '{worker_password}' noinherit nobypassrls nocreatedb nocreaterole;create database {database} owner likerts_migrator;",'postgres','postgres')
    owner_url = f'postgres://likerts_migrator:{password}@postgres:5432/{database}?sslmode=disable'
    run(['docker','run','--rm','--network',network,'--platform','linux/amd64','--entrypoint','/usr/local/bin/likerts-migrate','-e','LIKERTS_MIGRATION_DATABASE_URL',images['0.1.2']],env={**os.environ,'LIKERTS_MIGRATION_DATABASE_URL':owner_url})
    for path in scopes[1:]: sql('\\set runtime_role likerts_runtime\n'+run(['git','show',RELEASES['0.1.2']['source']+':'+path]))
    initial_schema = schema(); parsed = json.loads(initial_schema)
    assert parsed['allSuccessful'] and parsed['versions']==list(range(1,28))
    role_count = sql("select count(*) from pg_roles where rolname in ('likerts_runtime','likerts_webhook_worker') and rolcanlogin and not rolsuper and not rolinherit and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls")
    assert role_count=='2'
    assert sql("select count(*) from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname in ('likerts_runtime','likerts_webhook_worker')")=='0'
    tenant_sql(f"insert into likerts.workspaces(id) values('{workspace}');insert into likerts.service_credentials(workspace_id,id,name,token_hash,scopes,expires_at) values('{workspace}','{credential}','Version rollback fixture',decode('{hashlib.sha256(token.encode()).hexdigest()}','hex'),array['surveys:write','surveys:read','collections:write','collections:read','responses:read','exports:write','exports:read'],now()+interval '30 minutes'),('{workspace}','{denied_id}','Revocation control',decode('{hashlib.sha256(denied_token.encode()).hexdigest()}','hex'),array['surveys:read'],now()+interval '30 minutes')")
    crypto_keys = {key:base64.b64encode(secrets.token_bytes(32)).decode() for key in ['LIKERTS_COLLECTION_CREDENTIAL_KEY','LIKERTS_WEBHOOK_CREDENTIAL_KEY']}
    stage = 'old_0_1_1_baseline'; start_web('0.1.1')
    assert request('/api/v1/surveys',auth=denied_token)[0]==200
    fleet = json.loads((ROOT/'control-plane/public/docs/sdk-capabilities.json').read_text())
    survey = accepted('/api/v1/surveys','POST',{'idempotencyKey':run_id,'title':'Version rollback fixture','questions':[{'id':'rating','type':'scale','label':'Rating','required':True,'min':1,'max':5}]})
    version = accepted('/api/v1/surveys/'+survey['id']+'/publish','POST',{'revision':survey['revision'],'sdkCapabilities':fleet})
    assert version['version']==1
    collection = accepted('/api/v1/collections','POST',{'idempotencyKey':run_id,'surveyId':survey['id'],'version':1,'placement':'local-rollback','sdkCapabilities':fleet})
    response_path = '/api/v1/collections/'+collection['id']+'/responses'
    r0, receipt0 = submit(0); responses([receipt0])
    stage = 'new_0_1_2_upgrade'; start_web('0.1.2')
    responses([receipt0]); assert accepted(response_path,'POST',r0,collection['token'])==receipt0
    r1, receipt1 = submit(1); responses([receipt0,receipt1])
    revoked = export('revoked-on-new',[receipt0,receipt1])
    accepted('/api/v1/exports/'+revoked['id'],'DELETE')
    assert request('/api/v1/exports/'+revoked['id']+'/download')[0]==410
    journal = revocation_snapshot(revoked['id'])
    tenant_sql(f"update likerts.service_credentials set revoked_at=now() where workspace_id='{workspace}' and id='{denied_id}'")
    assert request('/api/v1/surveys',auth=denied_token)[0]==401
    stage = 'old_0_1_1_rollback'; start_web('0.1.1')
    responses([receipt0,receipt1])
    for value,receipt in [(r0,receipt0),(r1,receipt1)]: assert accepted(response_path,'POST',value,collection['token'])==receipt
    assert request('/api/v1/exports/'+revoked['id']+'/download')[0]==410
    assert revocation_snapshot(revoked['id'])==journal
    assert request('/api/v1/surveys',auth=denied_token)[0]==401
    r2, receipt2 = submit(2); responses([receipt0,receipt1,receipt2])
    final_export = export('after-rollback',[receipt0,receipt1,receipt2])
    state = accepted('/drill/status'); assert 0<state['memory']['peak']<536870912
    assert schema()==initial_schema
    (private/'observations.json').write_text(json.dumps({'phases':observations,'schema':parsed,'journal':journal},indent=2))
    report = {'passed':True,'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'releases':RELEASES,'sequence':['0.1.1','0.1.2','0.1.1'],'postgresVersion':16,'schemaVersions':27,
              'schemaChecksumsUnchanged':True,'strictRoles':True,'responses':3,'crossVersionIdempotency':True,
              'newVersionRevocationPersisted':True,'journalAndOutboxUnchanged':True,'revokedCredentialDenied':True,
              'finalExportReceiptSetAndHashVerified':True,'anonymousDenied':True,'distinctSupervisorBoots':3,
              'runtimeArchitecture':'amd64 under ARM-host QEMU' if emulated else 'native amd64',
              'identityBoundary':'local emulation adapter' if emulated else 'native executable/UID/PID guard',
              'hostedRollbackProven':False,'productionTouched':False,'oldRuntimeKnownRevocationGapStillPresent':True}
except Exception as failure:
    (private/'failure.txt').write_text(type(failure).__name__+': '+str(failure))
    print(json.dumps({'passed':False,'stage':stage,'error':'local_version_rollback_failed'}),flush=True)
finally:
    cleanup = True
    for kind,name in reversed(created):
        result = subprocess.run(['docker',kind,'rm','-f',name] if kind=='container' else ['docker','network','rm',name],capture_output=True,timeout=30)
        cleanup = cleanup and result.returncode==0
    for image in built:
        result = subprocess.run(['docker','image','rm',image],capture_output=True,timeout=30)
        cleanup = cleanup and result.returncode==0
    if report:
        report['ownedResourcesRemoved']=cleanup
        report['passed']=cleanup
        (HERE/'version-rollback-local-evidence.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report),flush=True)
    if not report or not cleanup: raise SystemExit(1)
