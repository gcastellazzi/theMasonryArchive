#!/usr/bin/env bash
# Crea (o riallinea) i due profili Hermes di The Masonry Archive.
#
#   masonry-admin    bot privato dell'amministratore: terminale nel repository
#   masonry-contrib  bot dei contributori: solo gli strumenti del plugin
#
# Rieseguibile: non tocca i token ne' gli utenti autorizzati, che si inseriscono
# a mano con `hermes -p <profilo> gateway setup` e non passano da questo file.
# SOUL, skill e plugin sono link simbolici al repository: si aggiornano con git.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERE="$REPO/hermes"
VISION_MODEL="${MASONRY_VISION_MODEL:-qwen3.5:9b}"

profile_home() { hermes profile show "$1" | awk '/^Path:/ {print $2}'; }

ensure_profile() {
  local name="$1" description="$2"
  if ! hermes profile show "$name" >/dev/null 2>&1; then
    # --clone copia modello e provider dal profilo attivo, senza i token dei bot.
    hermes profile create "$name" --clone --no-alias --description "$description"
  fi
}

link() {
  local target="$1" link_path="$2"
  mkdir -p "$(dirname "$link_path")"
  if [[ -e "$link_path" && ! -L "$link_path" ]]; then
    mv "$link_path" "$link_path.bak.$(date +%Y%m%d%H%M%S)"
  fi
  ln -sfn "$target" "$link_path"
}

# ---------------------------------------------------------------- contributori
ensure_profile masonry-contrib "Bot Telegram dei contributori di The Masonry Archive: registrazione e invio di foto in quarantena."
CONTRIB="$(profile_home masonry-contrib)"
link "$HERE/masonry-contrib/SOUL.md" "$CONTRIB/SOUL.md"
link "$HERE/plugins/masonry_contrib" "$CONTRIB/plugins/masonry_contrib"

c() { hermes -p masonry-contrib config set "$@" >/dev/null; }
c plugins.enabled '["masonry_contrib"]'
# Su Telegram il bot ha solo i suoi cinque strumenti: niente terminale, file o web.
c platform_toolsets.telegram '["masonry_contrib"]'
# Memoria condivisa fra tutti gli utenti del bot: spenta, per non mescolare
# i dati di uno studente nelle conversazioni di un altro.
c memory.memory_enabled false
c memory.user_profile_enabled false
c memory.nudge_interval 0
# Ollama serve il contesto impostato con OLLAMA_CONTEXT_LENGTH (vedi README): Hermes
# deve conoscerlo per comprimere in tempo, invece di fidarsi dei 262k del modello.
c model.context_length 65536
# Chi non e' autorizzato riceve un codice di abbinamento da girare all'amministratore.
c unauthorized_dm_behavior pair

# ---------------------------------------------------------------------- admin
ensure_profile masonry-admin "Assistente privato dell'amministratore di The Masonry Archive: avanzamento, moderazione dei contributi, proposte notturne."
ADMIN="$(profile_home masonry-admin)"
link "$HERE/masonry-admin/SOUL.md" "$ADMIN/SOUL.md"
link "$HERE/masonry-admin/skills/masonry-admin" "$ADMIN/skills/masonry-admin"
hermes -p masonry-admin config set terminal.cwd "$REPO" >/dev/null
hermes -p masonry-admin config set model.context_length 65536 >/dev/null

# Proposte notturne: script nel profilo admin, cron senza agente (lo script e'
# il lavoro, il suo output arriva su Telegram; output vuoto = nessun messaggio).
mkdir -p "$ADMIN/scripts"
cat > "$ADMIN/scripts/masonry-proposals.sh" <<EOF
#!/usr/bin/env bash
# Generato da hermes/install.sh — non modificare qui.
cd "$REPO" && exec python3 tools/propose_tags.py --limit 12 --model "$VISION_MODEL"
EOF
chmod +x "$ADMIN/scripts/masonry-proposals.sh"

# Riepilogo mattutino: foto da moderare, da far entrare, contributori da avvisare.
cat > "$ADMIN/scripts/masonry-digest.sh" <<EOF
#!/usr/bin/env bash
# Generato da hermes/install.sh — non modificare qui.
cd "$REPO" && exec python3 tools/intake_queue.py digest
EOF
chmod +x "$ADMIN/scripts/masonry-digest.sh"
# Elenco letto una volta: `cmd | grep -q` sotto pipefail fallisce per SIGPIPE
# proprio quando trova la riga, e il job verrebbe creato di nuovo.
JOBS="$(hermes -p masonry-admin cron list 2>&1 || true)"
if [[ "$JOBS" != *masonry-digest* ]]; then
  hermes -p masonry-admin cron create "0 8 * * *" --name masonry-digest \
    --no-agent --script masonry-digest.sh --deliver telegram
fi

if [[ "$JOBS" != *masonry-proposals* ]]; then
  if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$VISION_MODEL"; then
    hermes -p masonry-admin cron create "0 2 * * *" --name masonry-proposals \
      --no-agent --script masonry-proposals.sh --deliver telegram
  else
    echo
    echo "Cron delle proposte non creato: manca il modello $VISION_MODEL."
    echo "  ollama pull $VISION_MODEL && bash hermes/install.sh"
  fi
fi

cat <<EOF

Profili pronti:
  masonry-contrib  $CONTRIB
  masonry-admin    $ADMIN

Restano i token dei due bot (una volta sola):
  hermes -p masonry-admin gateway setup     # utenti autorizzati: solo il tuo ID Telegram
  hermes -p masonry-contrib gateway setup   # utenti autorizzati: vuoto; canale home: nessuno
  Accesso con codice d'invito: vedi hermes/README.md
EOF
