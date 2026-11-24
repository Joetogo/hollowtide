import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTIONS, actionOf, assignKey, keyName, keyOf, saneKeys, type Keys } from '../../src/config/keys';

describe('keys that can be chosen', () => {
  it('to begin with every action is on its own key, and other keys are themselves', () => {
    const keys: Keys = {};
    for (const action of Object.keys(ACTIONS)) {
      expect(keyOf(keys, action)).toBe(action);
      expect(actionOf(keys, action)).toBe(action);
    }
    for (const code of ['Escape', 'Enter', 'Space', 'ArrowUp', 'Digit3', 'KeyR'])
      expect(actionOf(keys, code)).toBe(code);
    expect(actionOf(keys, 'ShiftRight')).toBe('ShiftLeft'); // the two Shift keys are one
  });

  it('a free key takes an action over, and the key that had it does nothing', () => {
    const keys: Keys = {};
    expect(assignKey(keys, 'KeyW', 'KeyI')).toBe('');
    expect(keys).toEqual({ KeyW: 'KeyI' });
    expect(actionOf(keys, 'KeyI')).toBe('KeyW');
    expect(actionOf(keys, 'KeyW')).toBe('');
    // an arrow, a digit or Space can be had too, and then is no longer what it was
    expect(assignKey(keys, 'KeyF', 'ArrowUp')).toBe('');
    expect(actionOf(keys, 'ArrowUp')).toBe('KeyF');
    expect(actionOf(keys, 'ArrowDown')).toBe('ArrowDown');
  });

  it('a key that had an action swaps with it, so nothing is left without a key', () => {
    const keys: Keys = {};
    expect(assignKey(keys, 'KeyW', 'KeyS')).toBe('KeyS');
    expect(keys).toEqual({ KeyW: 'KeyS', KeyS: 'KeyW' });
    expect([actionOf(keys, 'KeyS'), actionOf(keys, 'KeyW')]).toEqual(['KeyW', 'KeyS']);
    // back again: nothing is kept for an action that is on its own key
    expect(assignKey(keys, 'KeyW', 'KeyW')).toBe('KeyS');
    expect(keys).toEqual({});
    // a key that was given away and is asked for by a third action
    assignKey(keys, 'KeyW', 'KeyI');
    expect(assignKey(keys, 'KeyM', 'KeyW')).toBe('');
    expect(keys).toEqual({ KeyW: 'KeyI', KeyM: 'KeyW' });
    expect(actionOf(keys, 'KeyM')).toBe('');
    // every action still has exactly one key, and no key two actions
    const used = Object.keys(ACTIONS).map((action) => keyOf(keys, action));
    expect(new Set(used).size).toBe(used.length);
  });

  it('the same key again changes nothing, and the keys the panel needs are not to be had', () => {
    const keys: Keys = {};
    expect(assignKey(keys, 'KeyW', 'KeyW')).toBe('');
    for (const code of ['Escape', 'Enter', 'Tab', 'MetaLeft', 'F5', ''])
      expect(assignKey(keys, 'KeyW', code)).toBeNull();
    expect(keys).toEqual({});
    expect(assignKey(keys, 'KeyE', 'ShiftRight')).toBe('ShiftLeft');
    expect(keys).toEqual({ KeyE: 'ShiftLeft', ShiftLeft: 'KeyE' });
  });

  it('what was remembered is taken only where it is an action and a key', () => {
    expect(saneKeys({ KeyW: 'KeyI', KeyR: 'KeyT', KeyM: 5, KeyH: 'Escape' })).toEqual({ KeyW: 'KeyI' });
    for (const junk of [null, undefined, 'KeyW', 7, []]) expect(saneKeys(junk)).toEqual({});
  });

  it('names a key as the page writes it', () => {
    expect(['KeyW', 'Digit4', 'ShiftLeft', 'ArrowLeft', 'Space', 'Comma'].map(keyName)).toEqual([
      'W',
      '4',
      'Shift',
      '←',
      'Space',
      'Comma',
    ]);
  });

  it('every key cap on the page that can be chosen is an action, and every action has a cap in the list', () => {
    const template = readFileSync('src/page/template.html', 'utf8');
    const caps = [...template.matchAll(/<button data-k=(\w+)>([^<]+)</g)];
    expect(caps.map((cap) => cap[1]).sort()).toEqual(Object.keys(ACTIONS).sort());
    // and it is written, before the script has run, as the script would write it
    for (const [, action, text] of caps) expect(text, action).toBe(keyName(action!));
    for (const [, action] of template.matchAll(/data-k=(\w+)/g)) expect(action! in ACTIONS, action).toBe(true);
  });
});
