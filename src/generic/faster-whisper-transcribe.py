#!/usr/bin/env python3
import argparse
import json
import sys

from faster_whisper import WhisperModel


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-path", required=True)
    parser.add_argument("--model", default="tiny")
    parser.add_argument("--language")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
    )
    transcribe_kwargs = {"vad_filter": True}
    if args.language:
        transcribe_kwargs["language"] = args.language

    segments, info = model.transcribe(args.audio_path, **transcribe_kwargs)
    text = "".join(segment.text for segment in segments).strip()

    payload = {
        "text": text,
        "language": getattr(info, "language", None),
        "languageProbability": getattr(info, "language_probability", None),
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
