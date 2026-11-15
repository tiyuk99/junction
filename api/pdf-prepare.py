import json
from http.server import BaseHTTPRequestHandler
from io import BytesIO

from pypdf import PdfReader, PdfWriter

from pdf_autofill import body, get_pdf, pdf_fields, send


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            data = body(self)
            values = data.get('values')
            if not isinstance(values, dict):
                raise ValueError('Review the form answers first.')
            pdf = get_pdf(data.get('url', ''))
            reader, fields = pdf_fields(pdf)
            allowed = {field['name']: field for field in fields if field['kind'] in ('text', 'choice')}
            prepared = {}
            for name, value in list(values.items())[:100]:
                field = allowed.get(name)
                if not field or not isinstance(value, str) or not value.strip():
                    continue
                value = value.strip()[:500]
                if field['options'] and value not in field['options']:
                    raise ValueError(f'Choose one of the official options for “{field["label"]}”.')
                prepared[name] = value
            if not prepared:
                raise ValueError('Add at least one answer before building the PDF.')
            writer = PdfWriter()
            writer.clone_document_from_reader(reader)
            writer.update_page_form_field_values(None, prepared, auto_regenerate=False, flatten=False)
            output = BytesIO()
            writer.write(output)
            checked = PdfReader(BytesIO(output.getvalue())).get_fields() or {}
            if any(str(checked.get(name, {}).get('/V', '')) != value for name, value in prepared.items()):
                raise ValueError('Some prepared answers did not validate in the output PDF.')
            missing = [{'label': field['label'][:120]} for field in fields if field['required'] and field['name'] not in prepared][:30]
            send(self, 200, output.getvalue(), 'application/pdf', {'Content-Disposition': 'attachment; filename="butler-application-review.pdf"', 'X-Prepared-Field-Count': str(len(prepared)), 'X-Missing-Required-Fields': json.dumps(missing)})
        except PermissionError as error:
            send(self, 403, {'error': str(error)})
        except Exception as error:
            send(self, 422, {'error': str(error)[:300] or 'Could not build the review PDF.'})

    def log_message(self, format, *args):
        return
