# Bot Telegram dell'archivio (Hermes)

Due profili [Hermes](https://github.com/NousResearch/hermes-agent), serviti dallo stesso gateway del digital twin di PETRAS ma isolati da esso e fra loro: ognuno ha il suo bot, la sua memoria, i suoi strumenti.

| Profilo | Chi lo usa | Strumenti |
|---|---|---|
| `masonry-contrib` | studenti e ricercatori, ammessi con un codice di abbinamento | solo i cinque del plugin `masonry_contrib` |
| `masonry-admin` | solo l'amministratore | terminale nel repository, skill `masonry-admin` |

## Il percorso di una foto

1. Il contributore scrive al bot, riceve un codice di abbinamento e lo gira all'amministratore, che lo approva (anche dal bot admin).
2. Si registra (nome, affiliazione, ruolo, consenso a CC BY 4.0 e all'informativa) e invia le foto **come file**, perche' Telegram toglie il GPS alle foto compresse.
3. `masonry_submit_photo` controlla tipo reale, dimensione, duplicati e posizione e mette la foto in quarantena in `incoming/` (fuori da git e dal sito).
4. L'amministratore accetta o rifiuta (`tools/intake_queue.py`, oppure chiedendolo al bot admin). `apply` fa passare gli accettati da `ingest_photos.py`: nascono record `pending` con il contributore come autore, da catalogare e approvare dal pannello come gli altri.
5. `notify` avvisa il contributore dell'esito, dallo stesso bot.

Ogni notte alle 2 un cron del profilo admin lancia `tools/propose_tags.py`: un modello di visione locale guarda una dozzina di foto `pending` e scrive proposte di titolo, elemento, tecnica, materiale, epoca e tag in `src/data/suggestions.json`. Si accettano una per una nel pannello admin. **Salvare il pannello prima di sera**: salva `suggestions.json` per intero e cancellerebbe le proposte della notte.

## Sicurezza del bot dei contributori

Il bot parla con persone esterne, quindi i controlli stanno nel codice del plugin, non nelle istruzioni al modello:

- l'identita' viene dal gateway (ID Telegram del mittente), non da un argomento del modello;
- si accettano solo file presenti nella cache degli allegati del profilo, quindi un percorso arbitrario viene rifiutato;
- il tipo si riconosce dai primi byte, non dall'estensione; limite di 25 MB e di 30 foto al giorno;
- memoria del profilo spenta, perche' e' condivisa fra tutti gli utenti;
- solo chat private.

## Installazione

```bash
bash hermes/install.sh                     # crea o riallinea i profili (rieseguibile)
hermes -p masonry-admin gateway setup      # token del bot admin; utenti: solo il tuo ID
hermes -p masonry-contrib gateway setup    # token del bot contributori; utenti: nessuno
hermes gateway restart                     # il gateway attivo inizia a servire i due profili
ollama pull qwen3.5:9b && bash hermes/install.sh   # crea il cron delle proposte notturne
```

SOUL, skill e plugin sono link simbolici a questa cartella: dopo un `git pull` basta `hermes gateway restart`.

`intake_queue.py apply` usa la pipeline di ingest, che richiede ImageMagick 7 (comando `magick`).
