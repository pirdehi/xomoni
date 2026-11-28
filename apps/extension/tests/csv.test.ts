import { describe, expect, it } from 'vitest';
import { MAX_CSV_ROWS, guessDelimiter, parseCsv } from '../src/shared/vault/csv';

// CSV as people and X write it (#425, CV.2.1, RFC 4180).

const cells = (text: string) => parseCsv(text).rows.map((r) => r.cells);

describe('parseCsv', () => {
  it('reads a header and rows, each row with the line it starts on', () => {
    const table = parseCsv('a,b\n1,2\n3,4\n');
    expect(table).toEqual({
      delimiter: ',',
      headers: ['a', 'b'],
      rows: [
        { line: 2, cells: ['1', '2'] },
        { line: 3, cells: ['3', '4'] },
      ],
      truncated: false,
      problems: [],
    });
    expect(MAX_CSV_ROWS).toBe(500_000);
  });

  it('drops a byte order mark, and reads CRLF, LF and CR line ends alike', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n').headers).toEqual(['a', 'b']);
    expect(cells('a,b\r\n1,2\r\n3,4')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(cells('a\r1\r2')).toEqual([['1'], ['2']]);
  });

  it('reads quoted cells, with "" for a quote, and separators and line breaks inside them', () => {
    const table = parseCsv('id,text,n\n1,"a ""quoted"", word",2\n3,"two\nlines",4\n5,last,6');
    expect(table.rows).toEqual([
      { line: 2, cells: ['1', 'a "quoted", word', '2'] },
      { line: 3, cells: ['3', 'two\nlines', '4'] },
      { line: 5, cells: ['5', 'last', '6'] },
    ]);
  });

  it('keeps a quote in the middle of a cell as it is', () => {
    expect(cells('a,b\nsay 5" long,x')).toEqual([['say 5" long', 'x']]);
  });

  it('guesses a semicolon or a tab from the header, never from inside quotes', () => {
    expect(guessDelimiter('a;b;c')).toBe(';');
    expect(guessDelimiter('a\tb\tc')).toBe('\t');
    expect(guessDelimiter('"a;b;c",d')).toBe(',');
    expect(guessDelimiter('single')).toBe(',');
    expect(parseCsv('a;b\n1,5;2').rows[0]?.cells).toEqual(['1,5', '2']);
    expect(parseCsv('a\tb\n1\t2').rows[0]?.cells).toEqual(['1', '2']);
  });

  it('skips blank lines, but keeps a row of empty cells and an empty quoted cell', () => {
    expect(cells('a,b\n\n1,2\n\n\n,\n""\n')).toEqual([['1', '2'], ['', ''], ['']]);
  });

  it('keeps a row with fewer or more cells than the header as it is', () => {
    expect(cells('a,b,c\n1\n1,2,3,4')).toEqual([['1'], ['1', '2', '3', '4']]);
  });

  it('drops the record a quote that never closes opens, and says where', () => {
    const table = parseCsv('a,b\n1,2\n3,"never closes\n4,5\n');
    expect(table.rows).toEqual([{ line: 2, cells: ['1', '2'] }]);
    expect(table.problems).toEqual([{ line: 3, problem: 'unclosed-quote' }]);
  });

  it('reads at most maxRows rows, and says the rest was left', () => {
    const table = parseCsv('a\n1\n2\n3\n4', { maxRows: 2 });
    expect(table.rows.map((r) => r.cells[0])).toEqual(['1', '2']);
    expect(table.truncated).toBe(true);
    expect(parseCsv('a\n1\n2', { maxRows: 2 }).truncated).toBe(false);
    expect(parseCsv('Post id,Likes\n1,2', { maxRows: 0 })).toMatchObject({ headers: ['Post id', 'Likes'], rows: [] });
  });

  it('reads an empty file as no header and no rows', () => {
    expect(parseCsv('')).toMatchObject({ headers: [], rows: [], problems: [] });
  });

  it('keeps markup and formula-like text as plain text', () => {
    expect(cells('t\n<script>alert(1)</script>\n"=HYPERLINK(""x"")"')).toEqual([
      ['<script>alert(1)</script>'],
      ['=HYPERLINK("x")'],
    ]);
  });
});
