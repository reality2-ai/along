"""Export AT's published trip shapes for offline contextual route maps."""
import csv,gzip,io,json,sys,zipfile
from pathlib import Path

def export(source,output):
    with zipfile.ZipFile(source) as z:
        def rows(name):return csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig'))
        trips={r['trip_id']:r.get('shape_id','') for r in rows('trips.txt')}
        shapes={}
        for r in rows('shapes.txt'):
            shapes.setdefault(r['shape_id'],[]).append((int(r['shape_pt_sequence']),round(float(r['shape_pt_lat']),5),round(float(r['shape_pt_lon']),5)))
        shapes={k:[[lat,lon] for _,lat,lon in sorted(v)] for k,v in shapes.items()}
    temporary=output.with_suffix('.building.gz')
    with gzip.open(temporary,'wt') as f:json.dump({'trips':trips,'shapes':shapes},f,separators=(',',':'))
    temporary.replace(output)
    print(f'Route geometry: {output.stat().st_size/1024/1024:.2f} MiB')
if __name__=='__main__':export(Path(sys.argv[1]),Path(sys.argv[2]))
