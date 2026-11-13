#!/usr/bin/env python3
"""Download the official TensorFlow.js COCO-SSD lite weights once for own-hosted inference."""
import hashlib,json,pathlib,urllib.request,urllib.parse,tempfile,shutil
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE='https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/'
target=ROOT/'shared/models/gear';target.parent.mkdir(parents=True,exist_ok=True)
stage=pathlib.Path(tempfile.mkdtemp(prefix='gear-stage-',dir=target.parent));total=0;files=[]
def download(name):
 global total
 if not name or '/' in name or '\\' in name or name in {'.','..'}:raise ValueError('Invalid model asset path')
 with urllib.request.urlopen(BASE+urllib.parse.quote(name),timeout=40) as response:data=response.read(8_000_001)
 if len(data)>8_000_000:raise ValueError('Model asset too large')
 total+=len(data)
 if total>32_000_000:raise ValueError('Model exceeds bundled budget')
 (stage/name).write_bytes(data);files.append({'name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()});return data
try:
 model=json.loads(download('model.json'))
 for group in model['weightsManifest']:
  for name in group['paths']:download(name)
 (stage/'source.json').write_text(json.dumps({'source':BASE,'upstream':'https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd','codeLicense':'Apache-2.0','purpose':'80-class object detection, not exhaustive hiking equipment assessment','files':files},indent=2)+'\n')
 if target.exists():raise ValueError('Existing model preserved; review before replacing')
 stage.rename(target);print('Own-hosted model downloaded:',total,'bytes')
finally:
 if stage.exists():shutil.rmtree(stage)
