import * as ES from "elasticsearch";

export const ElasticSearch = {
  host: process.env.ES_HOST || "http://localhost:9200/",
  log: process.env.ES_LOG || "error"
}

export class ESClient {
  private static instance: ESClient;
  private _client: ES.Client;

  constructor() {
    if (ESClient.instance) {
      return ESClient.instance;
    }
    ESClient.instance = this;

    this._client = new ES.Client(ElasticSearch);
  }

  public client() {
    return this._client;
  }
}
