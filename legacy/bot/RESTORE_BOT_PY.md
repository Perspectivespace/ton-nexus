# Восстановить legacy/bot/bot.py

```bash
cd legacy/bot
cat bot.py.zlib.b64.part1 bot.py.zlib.b64.part2 > bot.py.zlib.b64
python3 -c "import pathlib,base64,zlib; p=pathlib.Path('.'); data=base64.b64decode((p/'bot.py.zlib.b64').read_text()); (p/'bot.py').write_bytes(zlib.decompress(data)); print('ok', (p/'bot.py').stat().st_size)"
```

Ожидаемый размер: 304432 bytes.
