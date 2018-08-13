import * as fs from 'fs-extra';
import * as path from 'path';
import * as cheerio from 'cheerio';
import csvStringify from 'csv-stringify';
import toPdf from 'office-to-pdf';
const tika = require('tika');
const tabula = require('./tabula-js/index');

import { ExtractedData } from './types';
import { ESClient } from './elasticsearch';

// const FILEPATH = './samples/SMR Policy.pdf';
// const FILEPATH = './samples/MIFID II.pdf';
// const FILEPATH = './samples/Twitter 10K Dec 2015.pdf';
// const FILEPATH = './samples/ast_sci_data_tables_sample.pdf';
// const FILEPATH = './samples/pptexamples.ppt';
const FILEPATH = './samples/13-Using_Powerpoint.ppt';

run(FILEPATH);

let pageCount = 0;
let paragraphCount = 0;
let sentenceCount = 0;
let tableCount = 0;

async function run(filepath: string) {
  try {
    if (!fs.existsSync(filepath)) {
      console.error(`File not found: ${filepath}`);
      return;
    }

    const content = await extractContent(filepath);
    const esItem = await indexContentBySegments(content, 'tika-file', filepath);
    console.log('ES index response', esItem);

    const filepathPdf = await convertToPdf(filepath, content.meta);

    if (filepathPdf !== null) {
      const tabulaResponse = await extractTablesFromPdf(filepathPdf);
      const htmlTables = await Promise.all(tabulaResponse.map(table => tabulaDataToHtml(table.data)));
      console.log(htmlTables.length, 'tables extracted by Tabula');
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

    if (tables.length > 0) {
      console.log(tables.length, 'tables extracted by Tika');
    }

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

async function indexTables(esItem: any, tables: string[]) {
  return new Promise((resolve, reject) => {
    if (tables.length === 0) return resolve();
    tableCount = 0; // reset

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
              tables: tables.map(csv => ({
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
    const rows = [...data.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join(' ') + '</tr>')];
    const table = '<table>\n' + rows.join('\n') + '</table>';
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

async function convertToPdf(filepath, meta) {
  if (meta['Content-Type'] === 'application/pdf') return filepath;

  const filename = path.basename(filepath);
  const extension = path.extname(filename);

  // ppt => pdf supported yet
  if (extension.match(/pptx?/i)) {
    try {
      const fileContent = await fs.readFile(filepath);
      const pdfBuffer = await toPdf(fileContent);
      const newFilepath = './tmp/' + filename + '.pdf';
      await fs.ensureDir(path.resolve(path.dirname(newFilepath)));
      await fs.writeFile(newFilepath, pdfBuffer);

      return newFilepath;
    } catch (err) {
      console.error(`Unable to convert ${extension} => pdf`, err);
    }
  }

  return null;
}
