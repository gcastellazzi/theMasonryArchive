import { useEffect, useRef } from 'react';

/**
 * Scorciatoie da tastiera per la catalogazione.
 *
 * Catalogare centinaia di foto col mouse significa, per ogni scatto, mirare la
 * miniatura seguente, mirare il campo, mirare il bottone. La tastiera toglie i
 * tre spostamenti e lascia le mani dove serve scrivere.
 */

export type Shortcuts = {
  next: () => void;
  previous: () => void;
  approve: () => void;
  reject: () => void;
  pending: () => void;
  focusTag: () => void;
  focusSearch: () => void;
  toggleTagAt: (index: number) => void;
  clearSelection: () => void;
  undo: () => void;
  toggleHelp: () => void;
};

export const SHORTCUT_HELP: [string, string][] = [
  ['j / →', 'Next photo'],
  ['k / ←', 'Previous photo'],
  ['a', 'Approve'],
  ['r', 'Reject'],
  ['p', 'Return to pending'],
  ['t', 'Jump to the tag box'],
  ['1 – 9', 'Toggle one of the nine most used tags'],
  ['/', 'Jump to search'],
  ['⌘Z / Ctrl+Z', 'Undo'],
  ['Esc', 'Clear selection, or leave a field'],
  ['?', 'Show or hide this list'],
];

/** Vero quando si sta scrivendo: le lettere devono finire nel campo, non fare da comando. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

export function useShortcuts(shortcuts: Shortcuts, enabled: boolean): void {
  // I gestori cambiano identita' a ogni render, perche' catturano il record
  // selezionato. Tenerli in un ref permette di agganciare il listener una
  // volta sola invece di staccarlo e riattaccarlo a ogni battuta di tasto.
  const latest = useRef(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      const typing = isTyping(event.target);

      // L'annullamento vale anche mentre si scrive: e' la scorciatoia che
      // tutti si aspettano di trovare ovunque.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        if (typing) return; // Dentro un campo annulla la scrittura, non la modifica.
        event.preventDefault();
        latest.current.undo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Escape') {
        if (typing) {
          (event.target as HTMLElement).blur();
          return;
        }
        latest.current.clearSelection();
        return;
      }

      if (typing) return;

      switch (event.key) {
        case 'j':
        case 'ArrowRight':
          event.preventDefault();
          latest.current.next();
          return;
        case 'k':
        case 'ArrowLeft':
          event.preventDefault();
          latest.current.previous();
          return;
        case 'a':
          latest.current.approve();
          return;
        case 'r':
          latest.current.reject();
          return;
        case 'p':
          latest.current.pending();
          return;
        case 't':
          event.preventDefault();
          latest.current.focusTag();
          return;
        case '/':
          event.preventDefault();
          latest.current.focusSearch();
          return;
        case '?':
          latest.current.toggleHelp();
          return;
        default:
          break;
      }

      if (event.key >= '1' && event.key <= '9') {
        latest.current.toggleTagAt(Number(event.key) - 1);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
