#!/usr/bin/env python3
"""Convert owner-issued Apple certificate and profile using the prepared local key."""
import argparse,pathlib,subprocess,plistlib,json,os,datetime
p=argparse.ArgumentParser();p.add_argument('--certificate',required=True);p.add_argument('--profile',required=True);p.add_argument('--private-dir',default='/Users/nanyu/.local/share/hiking-earth/signing/ios');a=p.parse_args();root=pathlib.Path(a.private_dir).resolve()
repo=pathlib.Path(__file__).resolve().parents[1]
if repo==root or repo in root.parents:raise SystemExit('Keep Apple signing files outside the repository')
key=root/'distribution-private.pem';password=root/'key-password.txt';cer=pathlib.Path(a.certificate).resolve();profile=pathlib.Path(a.profile).resolve()
if not all(f.is_file() for f in [key,password,cer,profile]):raise SystemExit('Signing inputs missing')
def run(args):return subprocess.check_output(args,stderr=subprocess.PIPE)
xml=run(['security','cms','-D','-i',str(profile)]);data=plistlib.loads(xml)
application=data.get('Entitlements',{}).get('application-identifier','')
if application.split('.',1)[-1]!='earth.hiking.app':raise SystemExit('Profile does not belong to earth.hiking.app')
if data.get('ExpirationDate',datetime.datetime.min)<=datetime.datetime.utcnow():raise SystemExit('Provisioning profile expired')
if data.get('Entitlements',{}).get('get-task-allow') is True:raise SystemExit('Use a Distribution profile for release, not Development')
certificate=root/'distribution.pem';bundle=root/'distribution.p12';config=root/'pack-config.json'
if any(f.exists() for f in [certificate,bundle,config]):raise SystemExit('Existing signing output retained; choose a new private directory')
certificate.write_bytes(run(['openssl','x509','-inform','DER','-in',str(cer),'-outform','PEM']))
public_cert=run(['openssl','x509','-in',str(certificate),'-pubkey','-noout'])
public_key=run(['openssl','pkey','-in',str(key),'-passin','file:'+str(password),'-pubout'])
if public_cert!=public_key:certificate.unlink();raise SystemExit('Certificate does not match the prepared CSR private key')
profile_certificates=data.get('DeveloperCertificates',[])
cert_der=run(['openssl','x509','-in',str(certificate),'-outform','DER'])
if cert_der not in profile_certificates:certificate.unlink();raise SystemExit('Provisioning profile does not include this certificate')
subprocess.run(['openssl','pkcs12','-export','-inkey',str(key),'-passin','file:'+str(password),'-in',str(certificate),'-out',str(bundle),'-passout','file:'+str(password)],check=True,capture_output=True)
os.chmod(bundle,0o600)
fd=os.open(config,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
with os.fdopen(fd,'w') as f:json.dump({'ios':{'bundle':'earth.hiking.app','certfile':str(bundle),'profile':str(profile),'certpassword':password.read_text().strip()}},f)
print('Apple signing files validated and private build config prepared:',config)
print('Owner Apple agreements, App Store Connect upload authorization and device acceptance are separate.')
