"""Bounded JSON reads and serialization for the official-content collector."""
import json
from pathlib import Path


def read_json_bounded(path, byte_limit, label):
    if byte_limit < 0:
        raise ValueError(f'{label}: byte budget is invalid')
    with Path(path).open('rb') as stream:
        payload = stream.read(byte_limit + 1)
    if len(payload) > byte_limit:
        raise ValueError(f'{label}: JSON input exceeds the {byte_limit}-byte budget')
    try:
        return json.loads(payload.decode('utf-8'))
    except UnicodeDecodeError as error:
        raise ValueError(f'{label}: JSON input is not valid UTF-8') from error


def encode_json_bounded(value, byte_limit, label):
    payload = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    if len(payload) > byte_limit:
        raise ValueError(f'{label}: JSON output exceeds the {byte_limit}-byte budget')
    return payload
