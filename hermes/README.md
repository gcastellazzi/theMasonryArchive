# Bot Telegram dell'archivio (Hermes)

Due profili [Hermes](https://github.com/NousResearch/hermes-agent), serviti dallo stesso gateway del digital twin di PETRAS ma isolati da esso e fra loro: ognuno ha il suo bot, la sua memoria, i suoi strumenti.

| Profilo | Chi lo usa | Strumenti |
|---|---|---|
| `masonry-contrib` | studenti e ricercatori, ammessi con un codice d'invito | solo i cinque del plugin `masonry_contrib` |
| `masonry-admin` | solo l'amministratore | terminale nel repository, skill `masonry-admin` |

## Il percorso di una foto

1. Il contributore apre il bot e scrive il codice d'invito (`python3 tools/intake_queue.py invite` per vederlo o cambiarlo). Finche' non lo scrive riceve una risposta fissa e il modello non viene chiamato: e' l'hook `post_gateway_admission` del plugin.
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
- solo chat private;
- il profilo e' aperto a tutti su Telegram (`TELEGRAM_ALLOW_ALL_USERS=true` nel suo `.env`, da aggiungere a mano): il filtro e' il codice d'invito.

## Installazione

```bash
bash hermes/install.sh                     # crea o riallinea i profili (rieseguibile)
hermes -p masonry-admin gateway setup      # token del bot admin; utenti: solo il tuo ID
hermes -p masonry-contrib gateway setup    # token del bot contributori; utenti: nessuno, canale home: nessuno
# poi, a mano: TELEGRAM_ALLOW_ALL_USERS=true nel .env del profilo masonry-contrib
python3 tools/intake_queue.py invite CODICE  # il codice d'invito
hermes gateway restart                     # il gateway attivo inizia a servire i due profili
ollama pull qwen3.5:9b && bash hermes/install.sh   # crea il cron delle proposte notturne
```

SOUL, skill e plugin sono link simbolici a questa cartella: dopo un `git pull` basta `hermes gateway restart`.

`intake_queue.py apply` usa la pipeline di ingest, che richiede ImageMagick 7 (comando `magick`).

Ollama va avviato con un contesto di 64k token: Hermes si rifiuta di lavorare con meno di 64.000, e il default di Ollama (4096) non basta comunque per istruzioni, strumenti e una foto. L'API compatibile OpenAI usata da Hermes non permette di chiederne di piu' per singola richiesta, quindi si imposta sul server. Con `qwen3.5:4b` costa circa 2 GB di RAM oltre al modello (solo 8 strati su 32 hanno attenzione completa). `install.sh` imposta `model.context_length: 65536` nei due profili; sul server:

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment="OLLAMA_CONTEXT_LENGTH=65536"\n' | sudo tee /etc/systemd/system/ollama.service.d/context.conf
sudo systemctl daemon-reload && sudo systemctl restart ollama
```

`propose_tags.py` usa invece l'API nativa di Ollama e chiede solo 8k: di notte il 9B non alloca 64k che non gli servono.
