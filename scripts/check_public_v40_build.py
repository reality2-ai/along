import hashlib,json,subprocess,urllib.request,zipfile,io
from pathlib import Path
revision='1c4ac0fefb32e373b22dcb80f709ee22972ba7c0'
base='https://github.com/reality2-ai/along/releases/download/v0.40.0/'
root=Path('/tmp/along');root.mkdir()
def run(*args,cwd=root):subprocess.run(args,cwd=cwd,check=True)
run('git','init','-q');run('git','remote','add','origin','https://github.com/reality2-ai/along.git');run('git','fetch','--depth=1','origin',revision);run('git','checkout','--detach','FETCH_HEAD')
def archive(name,expected):
 data=urllib.request.urlopen(base+name,timeout=120).read()
 assert hashlib.sha256(data).hexdigest()==expected
 return zipfile.ZipFile(io.BytesIO(data))
app=archive('along-web-v40.zip','cae169ada5b168908127e9e089ebae8f7072a5c694ddbb12e041c958c304095f')
runtime=archive('along-r2-runtime-public-82377f1.zip','c241805a394fdcb8197b499914c17e283d4c5922081eeb2528f55c089379401f')
for name in runtime.namelist():
 p=Path(name);assert not p.is_absolute() and '..' not in p.parts
runtime.extractall(root/'releases')
for name in ['network','streets','addresses','routes']:(root/'data'/f'{name}.json.gz').write_bytes(app.read(f'data/{name}.json.gz'))
run('python3','scripts/build_upgrade_candidate.py','--runtime','releases/along-r2-runtime-public-82377f1')
candidate=root/'releases/along-regular-upgrade-candidate'
manifest=json.loads((candidate/'build-info.json').read_text())
expected=json.loads(app.read('build-info.json'))['files']
actual={k:v for k,v in manifest['files'].items() if k!='DO-NOT-PUBLISH.txt'}
application={k:v for k,v in expected.items() if k not in ('README.md','qualification.json')}
assert actual==application,{'missing':sorted(set(application)-set(actual)),'extra':sorted(set(actual)-set(application)),'changed':[k for k in set(actual)&set(application) if actual[k]!=application[k]]}
for name,digest in application.items():
 assert hashlib.sha256((candidate/name).read_bytes()).hexdigest()==digest
 assert (candidate/name).read_bytes()==app.read(name)
record={'status':'passed','source_commit':revision,'app_version':40,'application_files_matched':len(application),'source':'Anonymous public Git fetch','inputs':'Public v0.40.0 runtime archive and data bundles; both downloaded archives verified by pinned SHA-256','excluded_release_metadata':['README.md','qualification.json','build-info.json'],'scope':'Actual integrated Python app build in isolated Linux container, byte-for-byte application comparison. Prebuilt public runtime used here; its source/toolchain rebuild has separate evidence. No credentials, host source, node_modules or data mounted.'}
Path('/output/result.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
