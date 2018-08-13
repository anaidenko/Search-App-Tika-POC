import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import csvStringify from 'csv-stringify';
const tika = require('tika');
const tabula = require('./tabula-js/index');

import { ExtractedData } from './types';
import { ESClient } from './elasticsearch';

// const FILEPATH = './docs/SMR Policy.pdf';
// const FILEPATH = './docs/MIFID II.pdf';
const FILEPATH = './docs/Twitter 10K Dec 2015.pdf';
// const FILEPATH = './docs/ast_sci_data_tables_sample.pdf';

run();

let pageCount = 0;
let paragraphCount = 0;
let sentenceCount = 0;
let tableCount = 0;

async function run() {
  try {
    if (!fs.existsSync(FILEPATH)) {
      console.error(`File not found: ${FILEPATH}`);
      return;
    }

    const content = await extractContent(FILEPATH);
    const esItem = await indexContentBySegments(content, 'tika-file', FILEPATH);
    console.log('ES index response', esItem);

    if (content.meta['Content-Type'] === 'application/pdf') {
      const tabulaResponse = await extractTablesFromPdf(FILEPATH);
      const htmlTables = await Promise.all(tabulaResponse.map(table => tabulaDataToHtml(table.data)));
      // const csvTables = await Promise.all(tabulaResponse.map(table => tabulaDataToCsv(table.data)));
      // console.log("Extracted tables", csvTables);
      const response = await indexTables(esItem, htmlTables);
      console.log('ES tables index response', response);
    }
  } catch (err) {
    console.error('Error', err);
  }
}

async function extractContent(filepath) {
  return new Promise((resolve: (data: ExtractedData) => void, reject) => {
    tika.xhtml(filepath, (err, xhtml) => {
      if (err) reject(err);
      else {
        const $ = cheerio.load(xhtml);
        const $head = $('head');
        const $body = $('body');

        let meta = {};
        meta['title'] = $head.find('title').html();
        $head.find('meta[name]').each((i, el) => {
          const $meta = $(el);
          const name = $meta.attr('name');
          const content = $meta.attr('content');
          meta[name] = content;
        });

        $body
          .find('p')
          .filter((i, p) => ($(p).html() || '').trim() === '')
          .remove();
        // $body.find('.page').filter((i, page) => page.children.length === 0).remove()

        let html = $body.html() || '';

        resolve({
          $: $,
          meta: meta,
          html: html,
          $html: $body
        });
      }
    });
  });
}

async function indexContentBySegments(content: ExtractedData, es_index: string, filepath: string) {
  return new Promise((resolve, reject) => {
    const client = new ESClient().client();
    const filesize = fs.statSync(filepath).size;
    const $ = content.$;

    let pages = content.$html
      .find('.page')
      .toArray()
      .map(page => ($(page).children().length === 0 ? '' : $.html(page)))
      .filter(page => page !== '');

    let tables = content.$html
      .find('table')
      .toArray()
      .map(table => ({
        id: ++tableCount,
        content: $.html(table)
      }));

    const document = {
      content: formatHtml(content.html),
      pages: pages.map(page => {
        page = formatHtml(page).trim();

        let paragraphs = page
          .split(/<p[^>]*>/gi)
          .map(page => page.replace(/<\/?(p|div)[^>]*>/gi, ''))
          .filter(p => p !== '');

        return {
          id: ++pageCount,
          content: page,
          paragraphs: paragraphs.map(paragraph => {
            paragraph = paragraph.trim();

            const sentences = paragraph
              .replace(/\n+/g, '')
              .replace(/([.|!|?]+)/g, '$1\n')
              .split('\n');

            return {
              id: ++paragraphCount,
              content: paragraph,
              sentences: sentences.map(sentence => {
                sentence = sentence.trim();
                return {
                  id: ++sentenceCount,
                  content: sentence
                };
              })
            };
          })
        };
      }),
      tables: tables
    };

    client.index(
      {
        index: es_index,
        type: 'file',
        id: path.basename(filepath), // todo: remove
        requestTimeout: 1000 * 60 * 60 * 24,
        body: {
          timestamp: new Date().toISOString(),
          username: 'admin',
          filename: path.basename(FILEPATH),
          folder: '',
          attachment: {
            date: content.meta['date'],
            title: content.meta['title'],
            // language: 'en', // todo: detect language separately (tika.language command) as tika.xhtml doesn't do that for us
            keywords: content.meta['keywords'],
            content_length: filesize,
            content_type: content.meta['Content-Type'],
            ...document
          }
        }
      },
      (err, response) => {
        if (err) reject(err);
        else resolve(response);
      }
    );
  });
}

function formatHtml(html) {
  if (!html) return html;
  let result = html;
  result = result.replace(/([^.?!])\s*<\/p>\s*\n\s*<p>\s*([a-z&])/gi, '$1 $2'); // remove newlines from paragraphs
  result = result.replace(/&#xA0;/gi, ' ').replace(/&#x2019;/gi, "'");
  return result;
}

async function extractTablesFromPdf(filepath: string) {
  return new Promise((resolve: (data: any[]) => void, reject) => {
    // todo: impelement RESTful wrapper around tabula
    tabula(path.resolve(filepath), { guess: '', silent: '', pages: 'all', format: 'JSON' }).extractCsv((err, data) => {
      if (err) reject(err);
      else resolve(JSON.parse(data));
    });
  });
}

async function indexTables(esItem: any, csvTables: string[]) {
  return new Promise((resolve, reject) => {
    if (csvTables.length === 0) return resolve();

    const client = new ESClient().client();
    client.update(
      {
        index: esItem._index,
        type: 'file',
        id: esItem._id,
        requestTimeout: 1000 * 60 * 60 * 24,
        body: {
          doc: {
            attachment: {
              tables: csvTables.map(csv => ({
                id: ++tableCount,
                content: csv
              }))
            }
          }
        }
      },
      (err, response) => {
        if (err) reject(err);
        else resolve(response);
      }
    );
  });
}

async function tabulaDataToHtml(result) {
  return new Promise((resolve: (csv: string) => void, reject) => {
    const data = result.map(row => row.map(cell => cell.text));

    let rows = [];
    rows = [...rows, data.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>')];
    let table = '<table>\n' + rows.join('\n') + '</table>';

    resolve(table);
  });
}

async function tabulaDataToCsv(result) {
  return new Promise((resolve: (csv: string) => void, reject) => {
    const data = result.map(row => row.map(cell => cell.text));
    csvStringify(
      data,
      {
        delimiter: ' | '
      },
      (err, response) => {
        if (err) reject(err);
        else resolve(response);
      }
    );
  });
}
