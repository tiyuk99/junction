import json
import os
import re
from http.server import BaseHTTPRequestHandler
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from pypdf import PdfReader
from io import BytesIO

MAX_BODY = 20_000
MAX_PDF = 15 * 1024 * 1024
OFFICIAL_SUFFIXES = ('.gov', '.gov.uk', '.gouv.fr', '.gouv.nc', '.go.jp', '.go.kr', '.go.th', '.europa.eu', '.canada.ca', '.gc.ca', '.finlandabroad.fi', '.mofa.go.jp', '.moj.go.jp', '.visa.go.kr', '.immigration.go.kr', '.ica.gov.sg', '.france-visas.gouv.fr', '.immi.homeaffairs.gov.au', '.ircc.canada.ca', '.um.fi', '.irishimmigration.ie')


def official_url(value):
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or '').lower().rstrip('.')
        return parsed.scheme == 'https' and not parsed.username and not parsed.password and parsed.port in (None, 443) and any(host == suffix.lstrip('.') or host.endswith(suffix) for suffix in OFFICIAL_SUFFIXES)
    except (TypeError, ValueError):
        return False


def send(handler, status, value, content_type='application/json; charset=utf-8', headers=None):
    data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header('Content-Type', content_type)
    handler.send_header('Content-Length', str(len(data)))
    handler.send_header('Cache-Control', 'no-store')
    handler.send_header('X-Content-Type-Options', 'nosniff')
    for key, item in (headers or {}).items():
        handler.send_header(key, item)
    handler.end_headers()
    handler.wfile.write(data)


def body(handler):
    length = int(handler.headers.get('content-length', '0'))
    if length < 2 or length > MAX_BODY:
        raise ValueError('Request is too large or empty.')
    data = json.loads(handler.rfile.read(length))
    origin = handler.headers.get('origin')
    if origin and urlparse(origin).netloc != handler.headers.get('host'):
        raise PermissionError('Cross-origin requests are not allowed.')
    return data


def get_pdf(url):
    if not official_url(url):
        raise PermissionError('Only HTTPS files hosted by an official government or embassy site can be opened here.')
    request = Request(url, headers={'Accept': 'application/pdf', 'User-Agent': 'Butler travel readiness demo'})
    with urlopen(request, timeout=15) as response:
        if not official_url(response.geturl()):
            raise PermissionError('The file redirected outside an official government site.')
        if response.headers.get_content_type() != 'application/pdf':
            raise ValueError('The official link did not return a PDF file.')
        data = response.read(MAX_PDF + 1)
    if len(data) > MAX_PDF:
        raise OverflowError('This PDF is larger than Butler can preview (15 MB).')
    if not data.startswith(b'%PDF-'):
        raise ValueError('The official link did not return a PDF file.')
    return data


def pdf_fields(data):
    reader = PdfReader(BytesIO(data))
    fields = []
    for name, field in (reader.get_fields() or {}).items():
        kind = str(field.get('/FT', ''))
        if kind not in ('/Tx', '/Ch', '/Btn'):
            continue
        tooltip = str(field.get('/TU', '')).strip()
        label = tooltip or name.rsplit('.', 1)[-1].split('[')[0].replace('_', ' ')
        options = []
        if kind == '/Ch':
            options = [str(option[-1] if isinstance(option, (list, tuple)) else option) for option in field.get('/Opt', [])][:60]
        fields.append({'name': name, 'label': label[:180], 'kind': {'/Tx': 'text', '/Ch': 'choice', '/Btn': 'button'}[kind], 'required': bool(int(field.get('/Ff', 0)) & 2), 'options': options})
    return reader, fields


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            data = body(self)
            if data.get('exaConsent') is not True or data.get('formAiConsent') is not True:
                raise PermissionError('Review and accept the form autofill data sharing first.')
            api_key = os.environ.get('EXA_API_KEY')
            if not api_key:
                raise RuntimeError('AI suggestions need a configured Exa key.')
            url = data.get('url', '')
            pdf = get_pdf(url)
            reader, fields = pdf_fields(pdf)
            fields = [field for field in fields if field['kind'] in ('text', 'choice')][:100]
            raw_profile = data.get('profile') or {}
            allowed_profile = ('fullName', 'nationality', 'passportExpiry', 'residence', 'permitType', 'permitExpiry', 'purpose', 'duration', 'departureDate', 'purposeNotes', 'accommodation')
            profile = {key: str(raw_profile[key]).strip()[:180] for key in allowed_profile if isinstance(raw_profile.get(key), str) and raw_profile[key].strip()}
            if not profile:
                raise ValueError('Add profile details before asking for suggestions.')
            field_view = [{key: field[key] for key in ('name', 'label', 'kind', 'options')} for field in fields]
            schema = {'type': 'object', 'additionalProperties': False, 'required': ['suggestions'], 'properties': {'suggestions': {'type': 'array', 'maxItems': 40, 'items': {'type': 'object', 'additionalProperties': False, 'required': ['field', 'answer'], 'properties': {'field': {'type': 'string'}, 'answer': {'type': 'string', 'maxLength': 180}}}}}}
            payload = {'query': f'For each official PDF form field, match a profile value only when its meaning is an exact fit. Do not guess. Return an empty answer for any field not directly supplied. Exact profile values: {json.dumps(profile)}. Form fields and allowed select options: {json.dumps(field_view)}.', 'type': 'auto', 'objective': 'Map only explicit profile details to matching fillable form fields; leave unknown official-form details blank.', 'systemPrompt': 'You are matching provided traveler profile values to labels of an official visa form. Never infer or invent facts, translate values, or fill identity numbers, dates of birth, addresses, application IDs, or other details not explicitly supplied. Return a value only if it is explicitly present in profile and clearly matches the field. For choice fields use an exact listed option or leave blank. Return at most 40 suggestions. This is a draft for human review, not a submitted application.', 'outputSchema': schema, 'includeDomains': [urlparse(url).hostname], 'numResults': 1, 'contents': {'highlights': False, 'maxAgeHours': 24}}
            request = Request('https://api.exa.ai/search', data=json.dumps(payload).encode(), headers={'x-api-key': api_key, 'Content-Type': 'application/json'}, method='POST')
            with urlopen(request, timeout=20) as response:
                result = json.loads(response.read())
            suggestions = result.get('output', {}).get('content', {}).get('suggestions', [])
            by_name = {field['name']: field for field in fields}
            values = {}
            for item in suggestions:
                field = by_name.get(item.get('field'))
                answer = item.get('answer', '').strip() if isinstance(item.get('answer'), str) else ''
                if field and answer in profile.values() and len(answer) <= 180 and (not field['options'] or answer in field['options']):
                    values[field['name']] = answer
            review = [{**by_name[name], 'answer': answer, 'suggested': True} for name, answer in values.items()]
            review += [{**field, 'answer': '', 'suggested': False} for field in fields if field['required'] and field['name'] not in values][:30]
            send(self, 200, {'fields': review, 'suggestions': len(values), 'requiredRemaining': sum(field['required'] and field['name'] not in values for field in fields)})
        except PermissionError as error:
            send(self, 403, {'error': str(error)})
        except OverflowError as error:
            send(self, 413, {'error': str(error)})
        except (ValueError, json.JSONDecodeError, HTTPError, URLError) as error:
            send(self, 422, {'error': 'Could not prepare the application draft.'})
        except Exception:
            send(self, 502, {'error': 'Could not prepare the application draft.'})

    def log_message(self, format, *args):
        return
