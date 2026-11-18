import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The page's markup and the code that reaches into it are in different files and nothing ties them together
// but names. Two elements with one id is how the look-speed slider once went missing: the page that could not
// start had a link with the same id, the style that hides that link hid the slider, and the code bound itself
// to the link.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const template = readFileSync(path.join(root, 'src/page/template.html'), 'utf8');
const markup = template.slice(template.indexOf('<body'));
const ids = [...markup.matchAll(/\sid=["']?([\w-]+)/g)].map((match) => match[1]!);

describe('the page', () => {
  it('has no id twice', () => {
    const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(twice).toEqual([]);
  });

  it('has every element the code asks for by id', () => {
    const asked = new Set<string>();
    for (const dir of ['src/ui', 'src/app']) {
      for (const name of readdirSync(path.join(root, dir))) {
        const source = readFileSync(path.join(root, dir, name), 'utf8');
        for (const match of source.matchAll(/(?:getElementById|\bel(?:<\w+>)?|\bslider|\bchoice)\('([\w-]+)'/g)) {
          asked.add(match[1]!);
        }
      }
    }
    expect(asked.size).toBeGreaterThan(20);
    expect([...asked].filter((id) => !ids.includes(id))).toEqual([]);
  });

  it('styles no id that is not there', () => {
    const style = template.slice(template.indexOf('<style>'), template.indexOf('</style>'));
    const styled = new Set([...style.matchAll(/#([a-z][\w-]*)/g)].map((match) => match[1]!));
    // (colours are #rgb and #rrggbbaa: they begin with a digit or are all hex letters and digits)
    const missing = [...styled].filter((id) => !ids.includes(id) && !/^[0-9a-f]{3,8}$/.test(id));
    expect(missing).toEqual([]);
  });

  it('has its three sliders, each an input of its own', () => {
    for (const id of ['look', 'fov', 'volume']) {
      expect(markup, id).toMatch(new RegExp(`<input id=${id} type=range `));
    }
  });
});
