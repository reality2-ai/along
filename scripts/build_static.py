"""Create a self-contained HTTPS-hostable PWA, including offline public datasets."""
import json
import hashlib
from datetime import datetime, timezone
from pathlib import Path
import shutil
import zipfile

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist'


def build():
    for name in ['network','streets','addresses','routes']:
        if not (ROOT/'data'/f'{name}.json.gz').exists():
            raise SystemExit(f'Missing {name} data. Complete the data imports first.')
    # This directory is generated output. Remove obsolete assets from earlier builds.
    if OUT.exists():shutil.rmtree(OUT)
    shutil.copytree(ROOT/'public',OUT,dirs_exist_ok=True)
    (OUT/'data').mkdir(exist_ok=True)
    for name in ['network','streets','addresses','routes']:
        shutil.copy2(ROOT/'data'/f'{name}.json.gz',OUT/'data'/f'{name}.json.gz')
    (OUT/'.nojekyll').touch()
    shutil.copy2(ROOT/'deploy'/'README.md',OUT/'README.md')
    for name in ['LICENSE','NOTICE.md']:
        if (ROOT/name).exists():shutil.copy2(ROOT/name,OUT/name)
    # Relative paths support both a custom domain and GitHub Pages /repository/ URLs.
    html=(OUT/'index.html').read_text().replace('href="/"','href="./"').replace('href="/','href="./').replace('src="/','src="./')
    (OUT/'index.html').write_text(html)
    manifest=json.loads((OUT/'manifest.webmanifest').read_text())
    for key in ['id','scope','start_url']:manifest[key]='./'
    for icon in manifest['icons']:icon['src']='.'+icon['src'] if icon['src'].startswith('/') else icon['src']
    (OUT/'manifest.webmanifest').write_text(json.dumps(manifest,indent=2)+'\n')
    datasets={}
    for file in sorted((OUT/'data').glob('*.gz')):
        datasets[file.name]={'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}
    info={'built_at':datetime.now(timezone.utc).isoformat(),'datasets':datasets}
    (OUT/'build-info.json').write_text(json.dumps(info,indent=2)+'\n')
    releases=ROOT/'releases';releases.mkdir(exist_ok=True)
    archive=releases/'along-web.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as output:
        for file in sorted(OUT.rglob('*')):
            if file.is_file():output.write(file,file.relative_to(OUT))
    (releases/'along-web.zip.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  along-web.zip\n')
    print(f'Static app built in {OUT}. Serve over HTTPS. Live AT updates require a separate backend.')
    print(f'Downloadable bundle: {archive} ({archive.stat().st_size/1024/1024:.1f} MiB)')


if __name__=='__main__':build()
