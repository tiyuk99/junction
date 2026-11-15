import json
import sys
from io import BytesIO

from pypdf import PdfReader, PdfWriter


def read_fields(reader):
    result = []
    for name, field in (reader.get_fields() or {}).items():
        kind = str(field.get("/FT", ""))
        if kind not in ("/Tx", "/Ch", "/Btn"):
            continue
        tooltip = str(field.get("/TU", "")).strip()
        label = tooltip or name.rsplit(".", 1)[-1].split("[")[0].replace("_", " ")
        options = []
        if kind == "/Ch":
            for option in field.get("/Opt", []):
                options.append(str(option[-1] if isinstance(option, (list, tuple)) else option))
        result.append({
            "name": name,
            "label": label[:180],
            "kind": {"/Tx": "text", "/Ch": "choice", "/Btn": "button"}[kind],
            "required": bool(int(field.get("/Ff", 0)) & 2),
            "options": options[:60],
        })
    return result


mode = sys.argv[1]
data = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
reader = PdfReader(BytesIO(sys.stdin.buffer.read()))
fields = read_fields(reader)

if mode == "fields":
    sys.stdout.write(json.dumps(fields, ensure_ascii=False))
elif mode == "fill":
    allowed = {field["name"]: field for field in fields if field["kind"] in ("text", "choice")}
    values = {}
    for name, value in data.items():
        field = allowed.get(name)
        if field and isinstance(value, str) and value.strip() and (field["kind"] != "choice" or value in field["options"]):
            values[name] = value[:500]
    if not values:
        raise ValueError("No reviewable profile answers matched text fields in this form.")
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    writer.update_page_form_field_values(None, values, auto_regenerate=False, flatten=False)
    output = BytesIO()
    writer.write(output)
    check = PdfReader(BytesIO(output.getvalue())).get_fields() or {}
    missing = [name for name, expected in values.items() if str(check.get(name, {}).get("/V", "")) != expected]
    if missing:
        raise ValueError("Some prepared answers did not validate in the output PDF.")
    sys.stdout.buffer.write(output.getvalue())
else:
    raise ValueError("Unsupported PDF operation.")
