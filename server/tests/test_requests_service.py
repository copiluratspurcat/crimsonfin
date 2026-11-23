"""Offline tests; no external Jellyfin, RSS site, or qBittorrent required."""
import io
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import requests_service as service

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_database=service.CFG.database
        self.old_download_dir=service.CFG.download_dir
        self.old_auto=service.CFG.automatic
        service.CFG.database=Path(self.tmp.name)/'requests.sqlite'
        service.CFG.download_dir=Path(self.tmp.name)/'downloads'
        service.CFG.automatic=False
        service.setup_database()
        self.server=ThreadingHTTPServer(('127.0.0.1',0),service.Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.base='http://127.0.0.1:'+str(self.server.server_port)
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join(timeout=3)
        service.CFG.database=self.old_database
        service.CFG.download_dir=self.old_download_dir
        service.CFG.automatic=self.old_auto
        self.tmp.cleanup()
    def fetch(self,path,method='GET',body=None,auth=True):
        headers={'Content-Type':'application/json'}
        if auth:headers['X-Emby-Token']='test-token'
        req=Request(self.base+path,headers=headers,method=method,
                    data=json.dumps(body).encode() if body is not None else None)
        try:
            with urlopen(req,timeout=3) as response:return response.status,json.load(response)
        except HTTPError as e:return e.code,json.load(e)
    def test_missing_login_denied(self):
        code,data=self.fetch('/api/requests',auth=False)
        self.assertEqual(code,401)
        self.assertIn('Jellyfin',data['error'])
    def test_can_create_request_but_cannot_spoof_user(self):
        with patch.object(service,'validate_jellyfin_token',return_value={'Id':'USER42','Name':'Test Family','Policy':{'IsAdministrator':False}}):
            code,data=self.fetch('/api/requests',method='POST',body={'title':'My Movie','kind':'Movie','year':2026,'requester_name':'Forged','requester_id':'ADMIN'})
            self.assertEqual(code,201)
            code,data=self.fetch('/api/requests')
            self.assertEqual(code,200)
            self.assertEqual(data['items'][0]['requester_name'],'Test Family')
            self.assertEqual(data['items'][0]['requester_id'],'USER42')
            self.assertNotIn('download_url',data['items'][0])
    def test_non_admin_cannot_approve(self):
        with patch.object(service,'validate_jellyfin_token',return_value={'Id':'A','Name':'Alice','Policy':{'IsAdministrator':False}}):
            _,data=self.fetch('/api/requests',method='POST',body={'title':'Movie Alpha','kind':'Movie'})
            code,_=self.fetch('/api/requests/'+data['id']+'/approve',method='POST',body={})
            self.assertEqual(code,403)
    def test_admin_approval_works(self):
        with patch.object(service,'validate_jellyfin_token',return_value={'Id':'ADMIN','Name':'Admin','Policy':{'IsAdministrator':True}}):
            _,data=self.fetch('/api/requests',method='POST',body={'title':'Movie Beta','kind':'Movie'})
            code,_=self.fetch('/api/requests/'+data['id']+'/approve',method='POST',body={})
            self.assertEqual(code,200)
            self.assertEqual(service.load_request(data['id'])['status'],'searching')
    def test_title_matching_and_series_protection(self):
        movie={'title':'My Great Movie','kind':'Movie','year':2025}
        entry={'title':'My.Great.Movie.2025.1080p','url':'https://media.example/movie.mkv'}
        self.assertEqual(service.score_entry(movie,entry),100)
        movie['year']=2024
        self.assertEqual(service.score_entry(movie,entry),0)
        series={'title':'Show Name','kind':'Series','season':1}
        self.assertEqual(service.score_entry(series,{'title':'Show.Name.S01E01.1080p'}),65)
        self.assertEqual(service.score_entry(series,{'title':'Show.Name.S01.1080p'}),90)
    def test_end_to_end_direct_rss_download(self):
        from http.server import BaseHTTPRequestHandler
        from time import sleep, monotonic
        class Fixture(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                if self.path == '/feed':
                    content=f'<rss><channel><item><title>Test.Movie.2026.1080p</title><enclosure url="http://127.0.0.1:{self.server.server_port}/test.mp4" /></item></channel></rss>'.encode()
                else: content=b'video-test-content'*128
                self.send_response(200);self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
        fixture=ThreadingHTTPServer(('127.0.0.1',0),Fixture)
        thread=threading.Thread(target=fixture.serve_forever,daemon=True);thread.start()
        cfg=service.CFG
        previous={k:getattr(cfg,k) for k in ('rss','allowed_hosts','allow_private_download_hosts','min_free_gb')}
        try:
            cfg.rss=f'http://127.0.0.1:{fixture.server_port}/feed'
            cfg.allowed_hosts={'127.0.0.1'}
            cfg.allow_private_download_hosts=True  # Only in this loopback test
            cfg.min_free_gb=0
            with patch.object(service,'validate_jellyfin_token',return_value={'Id':'A','Name':'Admin','Policy':{'IsAdministrator':True}}):
                code,data=self.fetch('/api/requests',method='POST',body={'title':'Test Movie','kind':'Movie','year':2026})
                self.assertEqual(code,201)
                self.fetch('/api/requests/'+data['id']+'/approve','POST',{})
            service.process_pending()
            self.assertEqual(service.load_request(data['id'])['status'],'queued')
            service.process_downloads()
            deadline=monotonic()+3
            while service.load_request(data['id'])['status']!='completed' and monotonic()<deadline:sleep(.05)
            self.assertEqual(service.load_request(data['id'])['status'],'completed')
            self.assertEqual(list(cfg.download_dir.glob('*.mp4'))[0].read_bytes(),b'video-test-content'*128)
        finally:
            for k,v in previous.items():setattr(cfg,k,v)
            fixture.shutdown();fixture.server_close();thread.join(timeout=3)
    def test_adata_wd_smart_routing(self):
        cfg=service.CFG
        previous={k:getattr(cfg,k) for k in ('media_drives','require_mountpoints','min_free_gb')}
        try:
            a=Path(self.tmp.name)/'ADATA';w=Path(self.tmp.name)/'WD'
            a.mkdir();w.mkdir()
            cfg.media_drives=f'ADATA={a};WD={w}'
            cfg.require_mountpoints=True
            cfg.min_free_gb=1
            usage=lambda path: SimpleNamespace(total=100*1024**3,free=(70 if Path(path)==w else 30)*1024**3,used=10)
            with patch.object(service.os.path,'ismount',return_value=True),patch.object(service.os,'access',return_value=True),patch.object(service.shutil,'disk_usage',side_effect=usage):
                drive,path=service.destination_for({'title':'Example Show','year':2024,'season':2,'kind':'Series'})
                self.assertEqual(drive,'WD')
                self.assertEqual(path,w/'TV Shows'/'Example Show (2024)'/'Season 02')
                self.assertTrue(service.enough_disk(1*1024**3,path))
                drive,path=service.destination_for({'title':'Example Movie','year':2023,'season':None,'kind':'Movie'})
                self.assertEqual(path,w/'Movies'/'Example Movie (2023)')
            with patch.object(service.os.path,'ismount',return_value=False):
                with self.assertRaises(service.ServiceError):
                    service.destination_for({'title':'No Disk','year':None,'season':None,'kind':'Movie'})
        finally:
            for k,v in previous.items():setattr(cfg,k,v)
    def test_tracker_php_torrent_link_imports_to_qbittorrent(self):
        cfg=service.CFG
        previous={k:getattr(cfg,k) for k in ('qbit_url','allowed_hosts','torrent_endpoints','allow_private_download_hosts','media_drives')}
        class Response:
            def __init__(self,value):self.value=value
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,*args):return self.value
        class FakeOpener:
            def __init__(self):self.requests=[]
            def open(self,req,timeout=0):
                self.requests.append(req)
                if req.full_url.endswith('/api/v2/torrents/add'):return Response(b'Ok.')
                return Response(b'd4:infod4:name4:teste')
        opener=FakeOpener()
        try:
            cfg.qbit_url='http://127.0.0.1:8080'
            cfg.allowed_hosts={'tracker.test'}
            cfg.torrent_endpoints={'/download.php'}
            cfg.allow_private_download_hosts=False
            cfg.media_drives=''
            with patch.object(service.socket,'getaddrinfo',return_value=[(None,None,None,None,('8.8.8.8',0))]),patch.object(service,'build_opener',return_value=opener):
                link='https://tracker.test/download.php?id=123&passkey=secret-example'
                self.assertEqual(service.validate_download_url(link),'torrent')
                client=service.Qbit.__new__(service.Qbit);client.opener=opener
                client.add(link,'crimsonfin_test',Path(self.tmp.name))
                self.assertIn('multipart/form-data',opener.requests[-1].headers.get('Content-type',''))
                self.assertIn(b'name="savepath"',opener.requests[-1].data)
                self.assertNotIn(b'passkey=secret-example',opener.requests[-1].data)
        finally:
            for k,v in previous.items():setattr(cfg,k,v)
    def test_invalid_request_endpoint_denied(self):
        with patch.object(service,'validate_jellyfin_token',return_value={'Id':'A','Name':'Alice','Policy':{'IsAdministrator':False}}):
            code,_=self.fetch('/api/something-else')
            self.assertEqual(code,404)

if __name__=='__main__':unittest.main()
