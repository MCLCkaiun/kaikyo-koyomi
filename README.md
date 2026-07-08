# 海況こよみ ― 航路コンディション年鑑

主要航路の波高・風速を毎日自動で記録し続け、「この航路は何月が荒れやすいか」を年間ヒートマップで見せ、「1年前の今日はどうだったか」を振り返れる部内向けサイトです。配船・訪船計画や RC 活動資料の裏付けに使えます。

**公開URL**: `https://<ユーザー名またはOrg名>.github.io/<リポジトリ名>/`
(GitHub Pages を有効化したあと、実際の URL に書き換えてください)

---

## このサイトの見方

- **年鑑ビュー**: 航路タブと年セレクタを切り替えて、GitHub の草(contribution graph)のような年間ヒートマップを見られます。セルの色は静穏(薄い水色)→大荒れ(濃紺)の4段階、斜線はデータなしです。セルにホバー(スマホはタップ)すると、その日の波高・風速が出ます。下の「月別サマリー」では、月ごとの「荒れ日数」(荒れ+大荒れの合計)を棒グラフで、点線で記録年平均も重ねて見られます。
- **こよみビュー**: 日付を選ぶと、その日の全航路の海況カードと、「1年前の今日」「2年前の今日」…をさかのぼるタイムラインが表示されます。「去年の今日は瀬戸内が荒れていた」がひと目で分かります。`#2025-07-08` のような URL でこよみビューへ直リンクできます。
- **荒れ判定のしきい値**: ヘッダー下に「波高○m以上 または 風速○m/s以上 で『荒れ』」と表示されます。既定値やその変更方法は下記「しきい値の変更方法」を参照してください。

---

## 初回セットアップ手順

このサイトは公開直後はデータが空です。次の手順で「育った状態」にしてください。

### 1. GitHub Pages を有効化する

1. リポジトリの「Settings」タブを開きます。
2. 左メニューから「Pages」を選びます。
3. 「Build and deployment」の「Source」で `Deploy from a branch` を選択します。
4. 「Branch」で公開したいブランチ(例: `main`)と `/ (root)` を選択し、「Save」をクリックします。
5. 数分待つと、ページ上部に公開 URL が表示されます。この URL をこの README の冒頭に反映してください。

### 2. Actions の権限を確認する

データ収集ワークフローがリポジトリへ commit できるよう、書き込み権限が必要です。

1. リポジトリの「Settings」→「Actions」→「General」を開きます。
2. 「Workflow permissions」で `Read and write permissions` を選択し、保存します。

### 3. backfill(過去データの一括取得)を手動実行する

1. リポジトリの「Actions」タブを開きます。
2. 左側のワークフロー一覧から「Backfill historical data」を選びます。
3. 右側の「Run workflow」ボタンを押します。
4. 入力欄はすべて空欄のままで実行すると、`config/routes.json` の `backfillStart`(既定 2018-01-01)から昨日までの全航路のデータが取得されます。特定の期間・航路だけ取得したい場合は `start_date` / `end_date` / `route`(航路 id)を指定してください。
5. 「Run workflow」を押すと実行が始まります。取得件数が多いと数分〜数十分かかります。Actions のログで進捗と、失敗したチャンク(該当日は `null` として記録されます)を確認できます。
6. 完了すると `data/history/` 以下に年別ファイルが commit されます。

### 4. daily(毎日の自動更新)が翌朝から自動で回ること

`daily.yml` は毎日 UTC 21:00(JST 6:00)に自動実行され、前日分のデータを全航路取得して commit します。手動実行や追加設定は不要です。直近7日以内に取得漏れ(`null`)があれば、実行のたびに埋め直しを試みます。

---

## 航路の追加・変更方法

`config/routes.json` を編集して push するだけで、サイトに反映されます。

```json
{
  "id": "example-route",
  "name": "表示名",
  "points": [
    { "name": "代表点1", "lat": 34.00, "lon": 135.00 },
    { "name": "代表点2", "lat": 34.10, "lon": 135.20 }
  ]
}
```

- `id`: 英小文字とハイフンのみ。他の航路と重複しないこと。`data/history/<id>/` のディレクトリ名にもなります。
- `points`: 緯度経度は必ず**海上**の座標にしてください(陸地だと波浪・風のデータが取得できません)。
- 航路の日次値は、複数 `points` の中で最も荒れた地点の値を採用します。

追加・変更後は、Actions の「Backfill historical data」をその航路 id を指定して実行してください(`route` 欄にその航路の `id` を入力)。既存の航路名を変更した場合は再取得不要ですが、`id` を変更した場合は新しい `id` で改めて backfill を実行してください。

---

## しきい値の変更方法

`config/routes.json` の `thresholds` を編集します。

```json
"thresholds": {
  "wave": { "calm": 1.0, "moderate": 2.0, "rough": 3.0 },
  "wind": { "calm": 8.0, "moderate": 13.9, "rough": 17.2 }
}
```

- 波高は m、風速は m/s 単位です。`calm < moderate < rough` の順に大きくしてください。
- **しきい値を変更しても、過去に記録済みの `cond`(判定結果)は自動では再計算されません。** 変更を過去データに反映するには、Actions の「Backfill historical data」を(必要な範囲・航路を指定して、または全期間・全航路で)再実行してください。同じ日を再取得しても波高・風速の実測値は変わらず、`cond` の判定だけが新しいしきい値で上書きされます。

---

## データソースと出典表記

海況データは **[Open-Meteo](https://open-meteo.com)** の無料 API(API キー不要・CORS 対応)から取得しています。

| 用途 | エンドポイント |
|---|---|
| 波浪(過去・直近) | `marine-api.open-meteo.com/v1/marine` |
| 風(過去、ERA5 再解析) | `archive-api.open-meteo.com/v1/archive` |
| 風(直近) | `api.open-meteo.com/v1/forecast` |

フッターに「Weather data by Open-Meteo.com」相当の出典表記を掲載しています(CC BY 4.0 帰属)。

> **⚠️ 利用規約に関する注意**: Open-Meteo の無料 API は非商用利用向けです。業務利用を本格化する場合は [Open-Meteo の利用規約](https://open-meteo.com/en/terms) を確認し、必要に応じて有償の API サブスクリプションを検討してください。本サイトの取得頻度は「1日1回の自動取得 + 初回backfill」の範囲にとどめており、無闇に増やさないでください。

波浪データがどこまで遡れるかは地点によって異なります(概ね 2020 年代以降)。風データ(ERA5)は 1940 年から取得可能です。取得できた実際の範囲は `data/meta.json` に記録され、こよみビューやヒートマップでは、データがない日は「データなし」として破綻なく表示されます。

---

## GoatCounter(アクセスカウンター)の設定手順

`index.html` にはすでに GoatCounter のトラッキングスクリプトが埋め込まれていますが、`YOUR-CODE` はプレースホルダのままです。差し替えなくてもサイトの動作には影響しません。

1. https://www.goatcounter.com/ でアカウントを作成します(無料)。
2. サイト作成時に指定する「コード」(サブドメイン部分)を控えます。
3. `index.html` 内の以下の行を探します。

   ```html
   <script data-goatcounter="https://YOUR-CODE.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
   ```

4. `YOUR-CODE` の部分を、手順2で控えたコードに置き換えて commit します。
5. GoatCounter のダッシュボードでアクセス状況を確認できます。

---

## ローカルで確認したい場合

`index.html` を直接ダブルクリックして開くと、ブラウザによっては `fetch` が `file://` 経由の JSON 読み込みをブロックします。ローカルサーバーを立てて確認してください。

```sh
cd kaikyo-koyomi  # このリポジトリのルート
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開きます。

データ取得スクリプトを手元で試す場合は Node.js 20 以上が必要です(外部パッケージのインストールは不要)。

```sh
node scripts/validate.js                                  # config/ と data/ の整合性チェック
START_DATE=2024-01-01 END_DATE=2024-01-31 ROUTE=setonaikai node scripts/backfill.js
node scripts/fetch-daily.js
```

---

## リポジトリ構成

```
├── index.html                          # 本体(単一ページ、年鑑/こよみの2ビュー)
├── css/style.css                       # スタイル
├── js/app.js                           # ヒートマップ・こよみ描画ロジック
├── config/routes.json                  # 航路定義・しきい値(編集すれば育つ)
├── data/
│   ├── meta.json                       # 記録日数・最終更新・航路ごとのデータ範囲
│   └── history/<route-id>/<year>.json  # 航路×年の日次データ
├── scripts/
│   ├── lib/                            # Open-Meteo クライアント・判定ロジック・入出力(共通)
│   ├── validate.js                     # config/ と data/ の検証(Node標準機能のみ)
│   ├── fetch-daily.js                  # 毎日の自動取得(daily.yml から実行)
│   └── backfill.js                     # 過去データ一括取得(backfill.yml から実行)
├── .github/workflows/
│   ├── daily.yml                       # 毎日 JST 6:00 に前日分を取得・commit
│   ├── backfill.yml                    # 手動実行で過去データを一括取得・commit
│   └── validate.yml                    # push/PR 時に config/・data/ を検証
└── README.md                           # このファイル
```

## スコープ外(今回は対応していないこと)

- 気象警報・台風情報の収集表示
- 燃料油価格・為替の記録
- 予報(未来)の表示
- 複数地点の地図表示(航路点は座標リストのみ)
