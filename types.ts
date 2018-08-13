export type ExtractedData = {
  $: CheerioStatic;
  meta: { [id: string]: string };
  html: string | null;
  $html: Cheerio;
}
