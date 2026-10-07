"""Pure source parsing; PDF support is imported only for PDF inputs."""
import io
import re
from pathlib import Path

MAX_BYTES = 8 * 1024 * 1024


class IngestionError(ValueError):
    pass


def chunks_from_file(name, data):
    if len(data) > MAX_BYTES or not data:
        raise IngestionError('Files must be nonempty and at most 8 MiB')
    suffix = Path(name).suffix.lower()
    if suffix not in {'.md', '.txt', '.pdf'}:
        raise IngestionError('Supported formats: Markdown, plain text, text-based PDF')
    pages = []
    if suffix == '.pdf':
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted or len(reader.pages) > 200:
                raise IngestionError('Encrypted PDFs and PDFs over 200 pages are unsupported')
            pages = [(i + 1, page.extract_text() or '') for i, page in enumerate(reader.pages)]
        except IngestionError:
            raise
        except Exception as exc:
            raise IngestionError('Invalid PDF') from exc
        if not any(text.strip()
                   for _, text in pages) or any(len(text.strip()) < 10 for _, text in pages):
            raise IngestionError(
                'Scanned or mixed scanned PDFs are unsupported; OCR is unavailable')
    else:
        try:
            pages = [(None, data.decode('utf-8'))]
        except UnicodeDecodeError as exc:
            raise IngestionError('Text files must be UTF-8') from exc
    chunks = []
    section = 'Document'
    for page, text in pages:
        for match in re.finditer(r'\S[^\n]*(?:\n(?!\n)[^\n]+)*', text):
            passage = match.group().strip()
            if passage.startswith('#'):
                section = passage.lstrip('# ').splitlines()[0][:200]
            for offset in range(0, len(passage), 1600):
                body = passage[offset:offset + 1600]
                chunks.append({
                    'text': body,
                    'page': page,
                    'section': section,
                    'start_offset': match.start() + offset,
                    'end_offset': match.start() + offset + len(body)
                })
    if not chunks:
        raise IngestionError('No readable text found')
    if len(chunks) > 1000:
        raise IngestionError('Document exceeds 1,000 chunks')
    return chunks
