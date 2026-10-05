'use client';

/**
 * ReplyClock command bar.
 *
 * A terminal prompt with autocomplete hints above it and a scrollback above
 * that. The root carries BOTH `command-bar` and `cmd-bar` because
 * `app/globals.css` force-hides either name on paper, and both are listed there
 * so a rename of one cannot silently start printing the bar.
 *
 * KEY CONTRACT (the split of responsibility with the parent)
 * ---------------------------------------------------------------
 * The parent owns `value`, `suggestions` and `output`. This component owns the
 * a11y wiring and the highlighted option index, and never parses anything.
 *
 *   ArrowDown        onCycleSuggestion(+1)   move the highlight down, wrap
 *   ArrowUp          onCycleSuggestion(-1)   move the highlight up, wrap
 *   Tab              onAcceptSuggestion()    commit the highlight; prevented
 *                                             while a list is open, so the
 *                                             first Tab completes and the
 *                                             next one leaves the field
 *   Enter            onAcceptSuggestion()    when a list is open, otherwise
 *                                             onSubmit(value)
 *   anything else    onChange(...)           free text
 *
 * Escape is deliberately NOT handled here: it belongs to whichever dialog is
 * open, and the help overlay's `?` is opened by the parent, not by this bar.
 */

import { useState } from 'react';
import type { KeyboardEvent } from 'react';

import { COMMAND_HELP } from '@/lib/commands';

/** One line of terminal output. `kind` picks the colour; `hint` is optional. */
export interface CommandOutputLine {
  kind: 'ok' | 'err' | 'info';
  text: string;
  hint?: string;
}

export interface CommandBarProps {
  value: string;
  suggestions: readonly string[];
  output: readonly CommandOutputLine[];
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCycleSuggestion: (direction: 1 | -1) => void;
  onAcceptSuggestion: () => void;
}

/** `lib/commands.ts` caps its hint list at 8; render at most that many. */
const MAX_SUGGESTIONS = 8;

/** Scrollback depth. Deeper history is the parent's to keep, not this bar's. */
const MAX_LOG_LINES = 4;

/** Fixed id for the listbox, referenced by the input's `aria-controls`. */
const LISTBOX_ID = 'command-bar-listbox';
const INPUT_ID = 'command-bar-input';

/** Option id for a highlight index. */
const optionId = (index: number): string => `${LISTBOX_ID}-opt-${index}`;

/**
 * Output styling. The bracketed tag is the non-colour encoding of `kind`, so a
 * red line is still identifiable in greyscale, and `hint` gets its own
 * indented line rather than being appended to the message.
 */
const OUTPUT_TONE: Record<
  CommandOutputLine['kind'],
  { text: string; border: string; tag: string }
> = {
  ok: { text: 'text-phosphor', border: 'border-l-phosphor', tag: '[ok]' },
  err: { text: 'text-breach', border: 'border-l-breach', tag: '[err]' },
  info: { text: 'text-chrome', border: 'border-l-rule', tag: '[inf]' },
};

/**
 * The commands worth showing before anything has been typed. Deliberately not
 * the whole library - four is a hint, twelve is a wall.
 */
const QUICK_COMMANDS: readonly string[] = ['help', 'filter stage=new', 'sort wait', 'sla 45'];

/**
 * Descriptions are read from `COMMAND_HELP` by verb, so the parser stays the
 * single source of truth for what each command does. A verb the parser does not
 * document yields no summary and the chip is dropped rather than rendered with
 * an empty tooltip.
 */
function helpSummaryFor(usage: string): string | null {
  const verb = usage.split(' ')[0] ?? '';
  const entry = COMMAND_HELP.find((candidate) => candidate.usage.split(' ')[0] === verb);
  return entry?.summary ?? null;
}

export function CommandBar({
  value,
  suggestions,
  output,
  onChange,
  onSubmit,
  onCycleSuggestion,
  onAcceptSuggestion,
}: CommandBarProps): JSX.Element {
  const [cursor, setCursor] = useState(0);

  const visible = suggestions.slice(0, MAX_SUGGESTIONS);
  // Clamped rather than reset: resetting on every list change would make the
  // second ArrowDown land back on the first row, because accepting a
  // suggestion changes the list.
  const activeIndex = visible.length === 0 ? -1 : Math.min(cursor, visible.length - 1);
  const activeId = activeIndex >= 0 ? optionId(activeIndex) : undefined;

  const logLines = output.slice(-MAX_LOG_LINES);
  const showQuickHint = value.trim().length === 0 && output.length === 0;

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (visible.length === 0) return;
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setCursor((index) => {
        const from = Math.min(index, visible.length - 1);
        return (from + direction + visible.length) % visible.length;
      });
      onCycleSuggestion(direction === 1 ? 1 : -1);
      return;
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      if (visible.length === 0) {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSubmit(value);
        }
        return;
      }
      event.preventDefault();
      onAcceptSuggestion();
    }
  }

  return (
    <div
      className="command-bar cmd-bar no-print w-full min-w-0 border-t border-rule bg-panel"
      data-command-bar="true"
    >
      {/* ---- scrollback ----------------------------------------------------- */}
      {/*
        `role="log"` carries an implicit polite live region; `aria-live` is
        restated for intent and `aria-relevant="additions"` is the mechanism
        that stops unchanged lines being re-announced. Keys are the index
        within the window, so a parent re-render with the same `output`
        reconciles to identical DOM and announces nothing - only a genuinely
        appended line is an addition.
      */}
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Command output"
        className="max-h-24 min-w-0 overflow-y-auto overflow-x-hidden border-b border-rule px-3 py-2"
      >
        {logLines.length === 0 ? (
          <p className="m-0 text-[11px] text-chrome">
            <span className="text-dim" aria-hidden="true">
              {'// '}
            </span>
            no output yet
          </p>
        ) : (
          logLines.map((line, index) => {
            const tone = OUTPUT_TONE[line.kind];
            return (
              <div key={index} className={`mb-1 border-l-2 pl-2 last:mb-0 ${tone.border}`}>
                <p className="m-0 break-words text-[12px]">
                  <span className={tone.text}>{tone.tag}</span>{' '}
                  <span className={tone.text}>{line.text}</span>
                </p>
                {line.hint !== undefined && line.hint.length > 0 ? (
                  <p className="m-0 mt-0.5 break-words border-l border-rule pl-2 text-[11px] text-chrome">
                    {line.hint}
                  </p>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* ---- autocomplete hint list ----------------------------------------- */}
      {visible.length > 0 ? (
        <ul
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Command suggestions"
          className="m-0 flex max-h-40 list-none flex-col overflow-y-auto overflow-x-hidden border-b border-rule p-0"
        >
          {visible.map((suggestion, index) => {
            const active = index === activeIndex;
            return (
              <li
                key={suggestion}
                id={optionId(index)}
                role="option"
                aria-selected={active}
                className={`flex min-w-0 items-baseline gap-2 px-3 py-0.5 ${
                  active ? 'bg-panel2' : ''
                }`}
              >
                {/* Non-colour highlight marker, matching the pane-corner idiom. */}
                <span
                  aria-hidden="true"
                  className="inline-block w-3 shrink-0 text-[12px] text-phosphor"
                >
                  {active ? '\u25B8' : '\u00A0'}
                </span>
                <span
                  className={`min-w-0 break-words text-[12px] ${
                    active ? 'text-phosphor' : 'text-chrome'
                  }`}
                >
                  {suggestion}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* ---- first-run hint -------------------------------------------------- */}
      {showQuickHint ? (
        <p className="m-0 flex flex-wrap items-center gap-1 border-b border-rule px-3 py-1 text-[11px]">
          <span className="visually-hidden">Most useful commands: </span>
          {QUICK_COMMANDS.map((usage, index) => {
            const summary = helpSummaryFor(usage);
            if (summary === null) return null;
            return (
              <span key={usage} className="inline-flex items-center gap-1">
                {index > 0 ? (
                  <span className="text-dim" aria-hidden="true">
                    &middot;
                  </span>
                ) : null}
                {/*
                  Not a `.btn`: that class force-uppercases, and an uppercased
                  command string is not a command. These read as clickable
                  tokens in a terminal, which is what they are.
                */}
                <button
                  type="button"
                  title={summary}
                  onClick={() => onChange(usage)}
                  className="border border-rule px-1.5 py-0.5 text-[11px] normal-case text-phosphor hover:border-phosphor"
                >
                  {usage}
                  <span className="visually-hidden"> - {summary}</span>
                </button>
              </span>
            );
          })}
        </p>
      ) : null}

      {/* ---- prompt + input --------------------------------------------------- */}
      <div className="flex min-w-0 items-center gap-2 px-3 py-1">
        <span aria-hidden="true" className="shrink-0 select-none text-[12px] text-phosphor">
          &gt;
        </span>
        <label className="visually-hidden" htmlFor={INPUT_ID}>
          command
        </label>
        <input
          id={INPUT_ID}
          className="field min-w-0 flex-1"
          type="text"
          role="combobox"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          placeholder="help"
          aria-expanded={visible.length > 0}
          aria-controls={visible.length > 0 ? LISTBOX_ID : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
