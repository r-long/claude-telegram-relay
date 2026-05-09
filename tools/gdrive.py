#!/usr/bin/env python3
"""Google Drive CLI tool. Uses OAuth for uploads, service account for reads."""

import sys
import json
import os
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload
import io

SCOPES = ['https://www.googleapis.com/auth/drive']
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
SA_CREDS = os.path.join(TOOLS_DIR, '.secrets', 'gdrive-service-account.json')
OAUTH_TOKEN = os.path.join(TOOLS_DIR, '.secrets', 'gdrive-oauth-token.json')
OAUTH_CLIENT = os.path.join(TOOLS_DIR, '.secrets', 'gdrive-oauth-client.json')

def get_service(use_oauth=False):
    if use_oauth:
        with open(OAUTH_TOKEN) as f:
            token_data = json.load(f)
        creds = Credentials(
            token=token_data.get('access_token') or token_data.get('token'),
            refresh_token=token_data['refresh_token'],
            token_uri='https://oauth2.googleapis.com/token',
            client_id=token_data['client_id'],
            client_secret=token_data['client_secret'],
            scopes=SCOPES
        )
        if creds.expired or not creds.valid:
            creds.refresh(Request())
            token_data['access_token'] = creds.token
            token_data['token'] = creds.token
            with open(OAUTH_TOKEN, 'w') as f:
                json.dump(token_data, f)
        return build('drive', 'v3', credentials=creds)
    else:
        creds = service_account.Credentials.from_service_account_file(SA_CREDS, scopes=SCOPES)
        return build('drive', 'v3', credentials=creds)

def cmd_list(args):
    """List files. Usage: gdrive.py list [folder_id] [--query QUERY]"""
    service = get_service()
    folder_id = None
    query_parts = []

    i = 0
    while i < len(args):
        if args[i] == '--query' and i + 1 < len(args):
            query_parts.append(args[i + 1])
            i += 2
        else:
            folder_id = args[i]
            i += 1

    if folder_id:
        query_parts.append(f"'{folder_id}' in parents")
    query_parts.append("trashed = false")

    query = " and ".join(query_parts)
    results = service.files().list(
        q=query, pageSize=50,
        fields="files(id, name, mimeType, modifiedTime, size)",
        orderBy="modifiedTime desc"
    ).execute()

    files = results.get('files', [])
    if not files:
        print("No files found.")
        return

    for f in files:
        ftype = "📁" if f['mimeType'] == 'application/vnd.google-apps.folder' else "📄"
        size = f.get('size', '-')
        print(f"{ftype} {f['name']}  ({f['id']})  {f.get('modifiedTime', '')}  {size}")

def cmd_search(args):
    """Search files. Usage: gdrive.py search <query>"""
    if not args:
        print("Usage: gdrive.py search <query>")
        return
    service = get_service()
    query = f"name contains '{args[0]}' and trashed = false"
    results = service.files().list(
        q=query, pageSize=20,
        fields="files(id, name, mimeType, modifiedTime, size)"
    ).execute()

    files = results.get('files', [])
    if not files:
        print("No files found.")
        return
    for f in files:
        ftype = "📁" if f['mimeType'] == 'application/vnd.google-apps.folder' else "📄"
        print(f"{ftype} {f['name']}  ({f['id']})")

def cmd_download(args):
    """Download a file. Usage: gdrive.py download <file_id> [output_path]"""
    if not args:
        print("Usage: gdrive.py download <file_id> [output_path]")
        return
    service = get_service()
    file_id = args[0]

    meta = service.files().get(fileId=file_id, fields="name, mimeType").execute()
    name = meta['name']
    mime = meta['mimeType']
    output = args[1] if len(args) > 1 else name

    export_map = {
        'application/vnd.google-apps.document': ('application/pdf', '.pdf'),
        'application/vnd.google-apps.spreadsheet': ('text/csv', '.csv'),
        'application/vnd.google-apps.presentation': ('application/pdf', '.pdf'),
    }

    if mime in export_map:
        export_mime, ext = export_map[mime]
        if not output.endswith(ext):
            output += ext
        request = service.files().export_media(fileId=file_id, mimeType=export_mime)
    else:
        request = service.files().get_media(fileId=file_id)

    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()

    with open(output, 'wb') as f:
        f.write(fh.getvalue())
    print(f"Downloaded: {output}")

def cmd_upload(args):
    """Upload a file. Usage: gdrive.py upload <local_path> [folder_id]"""
    if not args:
        print("Usage: gdrive.py upload <local_path> [folder_id]")
        return

    local_path = args[0]
    folder_id = args[1] if len(args) > 1 else None

    try:
        service = get_service(use_oauth=True)  # OAuth for uploads
    except Exception:
        service = get_service(use_oauth=False)  # Fallback to service account
    file_metadata = {'name': os.path.basename(local_path)}
    if folder_id:
        file_metadata['parents'] = [folder_id]

    media = MediaFileUpload(local_path)
    file = service.files().create(body=file_metadata, media_body=media, fields='id, name, webViewLink').execute()
    print(f"Uploaded: {file['name']} ({file['id']})")
    if 'webViewLink' in file:
        print(f"Link: {file['webViewLink']}")

def cmd_info(args):
    """Show account info. Usage: gdrive.py info"""
    with open(SA_CREDS) as f:
        data = json.load(f)
    print(f"Service account: {data.get('client_email', 'unknown')}")
    print(f"Project: {data.get('project_id', 'unknown')}")
    print(f"OAuth token: {'present' if os.path.exists(OAUTH_TOKEN) else 'missing'}")

def main():
    commands = {
        'list': cmd_list,
        'search': cmd_search,
        'download': cmd_download,
        'upload': cmd_upload,
        'info': cmd_info,
    }

    if len(sys.argv) < 2 or sys.argv[1] not in commands:
        print(f"Usage: gdrive.py <{'|'.join(commands.keys())}> [args]")
        sys.exit(1)

    commands[sys.argv[1]](sys.argv[2:])

if __name__ == '__main__':
    main()
