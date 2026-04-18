export type ReferenceDemoField = {
  key: string;
  fieldName: string;
  fieldType: string;
  aiName: string;
  example: string;
  enumValue?: string | null;
  note?: string | null;
};

export type ReferenceDemoKnowledge = {
  id: string;
  name: string;
  aliases: string[];
  snapshotCount: number;
  score: number;
  description: string;
  assetName: string;
  owner: string;
  fields: ReferenceDemoField[];
  suggestedQuestions: string[];
};

export type ReferenceDemoKnowledgeTarget =
  | string
  | {
      name?: string | null;
      kind?: string | null;
      sampleDataset?: string | null;
      slug?: string | null;
    }
  | null;

type ReferenceAssetAliasEntry = {
  name: string;
  description?: string;
};

const buildFields = (
  prefix: string,
  rows: Array<
    [
      fieldName: string,
      fieldType: string,
      aiName: string,
      example: string,
      note?: string,
    ]
  >,
): ReferenceDemoField[] =>
  rows.map(([fieldName, fieldType, aiName, example, note], index) => ({
    key: `${prefix}-${index}`,
    fieldName,
    fieldType,
    aiName,
    example,
    enumValue: '暂无',
    note: note || '',
  }));

export const REFERENCE_DEMO_KNOWLEDGE_BASES: ReferenceDemoKnowledge[] = [
  {
    id: 'demo-kb-ecommerce',
    name: '电商订单数据（E-commerce）',
    aliases: [
      'ecommerce',
      'e-commerce',
      '电商订单数据',
      'github数据',
      'github data',
    ],
    snapshotCount: 8,
    score: 9.1,
    description:
      '基于原始 E-commerce 样例数据，覆盖订单、支付、评价、物流与品类分析场景，适合做销量、地域与履约分析。',
    assetName: '电商订单主题视图',
    owner: '系统样例',
    fields: buildFields('ecommerce-demo', [
      [
        'order_id',
        'string',
        '订单编号',
        'e481f51cbdc54678b7cc49136f2d6af7',
        '订单主键，可串联支付、评价与履约信息',
      ],
      [
        'customer_city',
        'string',
        '客户城市',
        'sao paulo',
        '用于地域分布与城市排行分析',
      ],
      ['customer_state', 'string', '客户州', 'SP', '可用于区域聚合与地图分析'],
      [
        'order_status',
        'string',
        '订单状态',
        'delivered',
        '典型值包含 delivered、shipped、canceled',
      ],
      ['price', 'number', '商品金额', '58.9', '订单商品成交金额'],
      [
        'payment_value',
        'number',
        '支付金额',
        '72.19',
        '聚合后可用于 GMV / 支付贡献分析',
      ],
      ['review_score', 'integer', '评价分', '5', '范围 1–5，用于满意度分析'],
      [
        'product_category_name',
        'string',
        '商品类目',
        'bed_bath_table',
        '如需英文类目名称，请通过 product_category_name_translation 做类目翻译映射',
      ],
    ]),
    suggestedQuestions: [
      '订单量最高的 3 个城市分别是谁？',
      '各州客户支付总额分别是多少？',
      '不同品类的评价分和销量有什么差异？',
    ],
  },
  {
    id: 'demo-kb-hr',
    name: '人力资源数据（HR）',
    aliases: ['hr', 'human resource', 'human resources', '人力资源数据'],
    snapshotCount: 6,
    score: 8.9,
    description:
      '基于原始 HR 样例数据，覆盖员工、部门、职级与薪资变动，适合做人力结构、部门分布与薪酬分析。',
    assetName: '员工人事主题视图',
    owner: '系统样例',
    fields: buildFields('hr-demo', [
      [
        'emp_no',
        'integer',
        '员工编号',
        '10001',
        '员工主键，可关联部门、职级与薪资',
      ],
      ['first_name', 'string', '名字', 'Georgi', '员工名'],
      ['last_name', 'string', '姓氏', 'Facello', '员工姓'],
      ['gender', 'string', '性别', 'M', '可能值为 M / F'],
      ['dept_name', 'string', '部门名称', 'Development', '员工所在部门'],
      [
        'title',
        'string',
        '岗位职级',
        'Senior Engineer',
        '员工在当前周期的岗位名称',
      ],
      ['salary', 'number', '薪资', '60117', '员工在当前周期的薪资'],
      ['hire_date', 'date', '入职日期', '1986-06-26', '用于司龄与招聘趋势分析'],
    ]),
    suggestedQuestions: [
      '各岗位的平均薪资分别是多少？',
      '男女员工在不同部门的平均薪资差异如何？',
      '各部门当前的经理分别是谁？',
    ],
  },
  {
    id: 'demo-kb-music',
    name: 'MUSIC',
    aliases: ['music'],
    snapshotCount: 7,
    score: 8.8,
    description:
      '基于 MUSIC 样例数据，覆盖用户、订单、发票与曲库信息，适合做内容消费与销售分析。',
    assetName: '音乐业务主题视图',
    owner: '系统样例',
    fields: buildFields('music-demo', [
      ['customer_id', 'integer', '用户编号', '1', '用于关联用户与订单行为'],
      ['invoice_id', 'integer', '发票编号', '42', '用于关联订单和支付信息'],
      ['track_id', 'integer', '曲目编号', '120', '用于关联曲目和专辑信息'],
      ['artist_name', 'string', '艺术家', 'AC/DC', '用于歌手与内容分布分析'],
      ['genre_name', 'string', '流派', 'Rock', '用于内容偏好分析'],
      ['unit_price', 'number', '单价', '0.99', '用于销售金额统计'],
      ['quantity', 'integer', '购买数量', '2', '用于销量聚合'],
    ]),
    suggestedQuestions: [
      '不同流派的销量和销售额分布如何？',
      '销售额最高的艺术家和专辑分别是谁？',
      '用户复购率最高的曲目类型有哪些？',
    ],
  },
  {
    id: 'demo-kb-nba',
    name: 'NBA',
    aliases: ['nba'],
    snapshotCount: 5,
    score: 8.8,
    description:
      '基于 NBA 样例数据，覆盖比赛、球员、球队与得分明细，适合做球队与球员表现分析。',
    assetName: 'NBA 比赛主题视图',
    owner: '系统样例',
    fields: buildFields('nba-demo', [
      ['game_id', 'integer', '比赛编号', '1', '用于关联比赛与明细记录'],
      ['player_id', 'integer', '球员编号', '23', '用于关联球员表现'],
      ['team_id', 'integer', '球队编号', '6', '用于关联球队维度'],
      ['points', 'integer', '得分', '31', '用于球员与球队得分分析'],
      ['assists', 'integer', '助攻', '8', '用于球员组织能力分析'],
      ['rebounds', 'integer', '篮板', '10', '用于攻防贡献分析'],
      ['game_date', 'date', '比赛日期', '2024-01-01', '用于赛程趋势分析'],
    ]),
    suggestedQuestions: [
      '本赛季得分最高的前 10 名球员是谁？',
      '各球队场均得分和失分分别是多少？',
      '不同比赛阶段的关键指标趋势如何变化？',
    ],
  },
];

export const DEFAULT_REFERENCE_DEMO_KNOWLEDGE =
  REFERENCE_DEMO_KNOWLEDGE_BASES[0];

export const REFERENCE_HOME_FALLBACK_QUESTION =
  DEFAULT_REFERENCE_DEMO_KNOWLEDGE.suggestedQuestions[0];

export const REFERENCE_HOME_RECOMMENDATIONS = [
  {
    question: REFERENCE_DEMO_KNOWLEDGE_BASES[0].suggestedQuestions[0],
    description: '快速查看地域分布、订单规模与关键城市排行。',
    badge: '热门',
  },
  {
    question: REFERENCE_DEMO_KNOWLEDGE_BASES[1].suggestedQuestions[0],
    description: '聚焦岗位与部门，快速切入 HR 结构和薪酬分析。',
    badge: '最新',
  },
  {
    question: REFERENCE_DEMO_KNOWLEDGE_BASES[0].suggestedQuestions[2],
    description: '把订单、品类和评价串起来做综合业务诊断。',
    badge: '热门',
  },
];

const REFERENCE_WORKSPACE_ALIASES: Array<[RegExp, string]> = [
  [/^demo workspace$/i, '演示工作区'],
];

const REFERENCE_SNAPSHOT_ALIASES: Array<[RegExp, string]> = [
  [/^local main$/i, '主线快照'],
];

const REFERENCE_ASSET_ALIASES: Record<
  string,
  Record<string, ReferenceAssetAliasEntry>
> = {
  'demo-kb-ecommerce': {
    customers: {
      name: '客户信息',
      description:
        '原始表：olist_customers_dataset，用于客户地域、城市和州的分布分析。',
    },
    olist_customers_dataset: {
      name: '客户信息',
      description:
        '原始表：olist_customers_dataset，用于客户地域、城市和州的分布分析。',
    },
    geolocation: {
      name: '地理位置',
      description:
        '原始表：olist_geolocation_dataset，用于邮编、经纬度和地区映射分析。',
    },
    olist_geolocation_dataset: {
      name: '地理位置',
      description:
        '原始表：olist_geolocation_dataset，用于邮编、经纬度和地区映射分析。',
    },
    orders: {
      name: '订单信息',
      description:
        '原始表：olist_orders_dataset，覆盖订单状态、履约时间和客户关联信息。',
    },
    olist_orders_dataset: {
      name: '订单信息',
      description:
        '原始表：olist_orders_dataset，覆盖订单状态、履约时间和客户关联信息。',
    },
    'order items': {
      name: '订单商品明细',
      description:
        '原始表：olist_order_items_dataset，用于商品粒度的销量、价格和商家分析。',
    },
    olist_order_items_dataset: {
      name: '订单商品明细',
      description:
        '原始表：olist_order_items_dataset，用于商品粒度的销量、价格和商家分析。',
    },
    'order payments': {
      name: '订单支付记录',
      description:
        '原始表：olist_order_payments_dataset，用于支付方式和支付金额分析。',
    },
    olist_order_payments_dataset: {
      name: '订单支付记录',
      description:
        '原始表：olist_order_payments_dataset，用于支付方式和支付金额分析。',
    },
    'order reviews': {
      name: '订单评价记录',
      description:
        '原始表：olist_order_reviews_dataset，用于满意度、评分和评价文本分析。',
    },
    olist_order_reviews_dataset: {
      name: '订单评价记录',
      description:
        '原始表：olist_order_reviews_dataset，用于满意度、评分和评价文本分析。',
    },
    products: {
      name: '商品信息',
      description:
        '原始表：olist_products_dataset，用于品类、尺寸和商品属性分析。',
    },
    olist_products_dataset: {
      name: '商品信息',
      description:
        '原始表：olist_products_dataset，用于品类、尺寸和商品属性分析。',
    },
    sellers: {
      name: '商家信息',
      description: '原始表：olist_sellers_dataset，用于商家地域和供给侧分析。',
    },
    olist_sellers_dataset: {
      name: '商家信息',
      description: '原始表：olist_sellers_dataset，用于商家地域和供给侧分析。',
    },
    'product category name translation': {
      name: '商品类目映射',
      description:
        '原始表：product_category_name_translation，用于类目翻译和中英文类目映射。',
    },
    product_category_name_translation: {
      name: '商品类目映射',
      description:
        '原始表：product_category_name_translation，用于类目翻译和中英文类目映射。',
    },
  },
  'demo-kb-hr': {
    employees: {
      name: '员工信息',
      description: '原始表：employees，用于员工基本属性、性别和入职时间分析。',
    },
    departments: {
      name: '部门信息',
      description: '原始表：departments，用于组织结构和部门维度分析。',
    },
    dept_emp: {
      name: '员工部门关系',
      description: '原始表：dept_emp，用于员工与部门的任职关系分析。',
    },
    dept_manager: {
      name: '部门经理关系',
      description: '原始表：dept_manager，用于部门负责人和管理链路分析。',
    },
    salaries: {
      name: '薪资记录',
      description: '原始表：salaries，用于薪资变化、历史工资和薪酬结构分析。',
    },
    titles: {
      name: '岗位记录',
      description: '原始表：titles，用于职级、岗位变化和任职轨迹分析。',
    },
  },
  'demo-kb-music': {
    customer: {
      name: 'customer',
      description: '原始表：customer，用于用户信息和地区分布分析。',
    },
    invoice: {
      name: 'invoice',
      description: '原始表：invoice，用于订单与支付分析。',
    },
    invoiceline: {
      name: 'invoiceLine',
      description: '原始表：invoiceLine，用于订单明细与曲目销量分析。',
    },
    track: {
      name: 'track',
      description: '原始表：track，用于曲目内容与时长分析。',
    },
    album: {
      name: 'album',
      description: '原始表：album，用于专辑内容结构分析。',
    },
    artist: {
      name: 'artist',
      description: '原始表：artist，用于艺术家维度分析。',
    },
    genre: {
      name: 'genre',
      description: '原始表：genre，用于流派分类与偏好分析。',
    },
  },
  'demo-kb-nba': {
    line_score: {
      name: 'line_score',
      description: '原始表：line_score，用于比赛分节得分和总分分析。',
    },
    player: {
      name: 'player',
      description: '原始表：player，用于球员基础信息和所属球队分析。',
    },
    player_games: {
      name: 'player_games',
      description: '原始表：player_games，用于球员单场表现分析。',
    },
    game: {
      name: 'game',
      description: '原始表：game，用于比赛级别统计分析。',
    },
    team: {
      name: 'team',
      description: '原始表：team，用于球队维度和赛季表现分析。',
    },
  },
};

const REFERENCE_THREAD_TITLE_ALIASES: Array<[RegExp, string]> = [
  [/^what is the total number of orders\??$/i, '订单总量是多少？'],
  [/^what is the total revenue\??$/i, '总收入是多少？'],
  [/^what is the average order value\??$/i, '平均订单金额是多少？'],
  [/^what is the total headcount\??$/i, '当前员工总数是多少？'],
];

const normalizeReferenceName = (value?: string | null) =>
  (value || '').trim().toLowerCase();

const getReferenceKnowledgeRawName = (value?: ReferenceDemoKnowledgeTarget) =>
  typeof value === 'string' ? value : value?.name;

const getReferenceKnowledgeCandidates = (
  value?: ReferenceDemoKnowledgeTarget,
) => {
  if (!value) {
    return [];
  }

  if (typeof value === 'string') {
    return [value];
  }

  if (value.kind && value.kind !== 'system_sample') {
    return [];
  }

  return [value.sampleDataset, value.slug, value.name];
};

const findAlias = (aliases: Array<[RegExp, string]>, value?: string | null) => {
  const raw = (value || '').trim();
  if (!raw) {
    return null;
  }

  for (const [pattern, label] of aliases) {
    if (pattern.test(raw)) {
      return label;
    }
  }

  return null;
};

const getReferenceAssetAliasEntry = (
  knowledgeName?: ReferenceDemoKnowledgeTarget,
  assetName?: string | null,
) => {
  const knowledgeId = getReferenceDemoKnowledgeByName(knowledgeName)?.id;
  const assetKey = normalizeReferenceName(assetName);
  if (!knowledgeId || !assetKey) {
    return null;
  }

  return REFERENCE_ASSET_ALIASES[knowledgeId]?.[assetKey] || null;
};

export const getReferenceDemoKnowledgeByName = (
  value?: ReferenceDemoKnowledgeTarget,
): ReferenceDemoKnowledge | null => {
  const normalizedCandidates = [
    ...new Set(
      getReferenceKnowledgeCandidates(value)
        .map((candidate) => normalizeReferenceName(candidate))
        .filter(Boolean),
    ),
  ];

  if (normalizedCandidates.length === 0) {
    return null;
  }

  return (
    REFERENCE_DEMO_KNOWLEDGE_BASES.find((item) =>
      normalizedCandidates.some(
        (candidate) =>
          candidate === normalizeReferenceName(item.name) ||
          candidate === normalizeReferenceName(item.id) ||
          item.aliases.some(
            (alias) => candidate === normalizeReferenceName(alias),
          ),
      ),
    ) || null
  );
};

export const getReferenceDisplayKnowledgeName = (
  value?: ReferenceDemoKnowledgeTarget,
) =>
  getReferenceDemoKnowledgeByName(value)?.name ||
  getReferenceKnowledgeRawName(value) ||
  '当前知识库';

export const getReferenceDisplayThreadTitle = (value?: string | null) => {
  const raw = (value || '').trim();
  if (!raw) {
    return '未命名对话';
  }

  for (const [pattern, translated] of REFERENCE_THREAD_TITLE_ALIASES) {
    if (pattern.test(raw)) {
      return translated;
    }
  }

  return raw;
};

export const getReferenceDisplayWorkspaceName = (value?: string | null) =>
  findAlias(REFERENCE_WORKSPACE_ALIASES, value) || value || '工作区';

export const getReferenceDisplaySnapshotName = (value?: string | null) =>
  findAlias(REFERENCE_SNAPSHOT_ALIASES, value) || value || '快照';

export const getReferenceDisplayAssetName = (
  knowledgeName?: ReferenceDemoKnowledgeTarget,
  assetName?: string | null,
) =>
  getReferenceAssetAliasEntry(knowledgeName, assetName)?.name ||
  assetName ||
  '未命名资产';

export const getReferenceDisplayAssetDescription = (
  knowledgeName?: ReferenceDemoKnowledgeTarget,
  assetName?: string | null,
  fallback?: string | null,
) =>
  getReferenceAssetAliasEntry(knowledgeName, assetName)?.description ||
  fallback ||
  null;

export const getReferenceAssetCountByKnowledgeName = (
  knowledgeName?: ReferenceDemoKnowledgeTarget,
) => {
  const reference = getReferenceDemoKnowledgeByName(knowledgeName);
  if (!reference?.id) {
    return null;
  }

  const assets = Object.values(REFERENCE_ASSET_ALIASES[reference.id] || {});
  const uniqueAssetNames = new Set(
    assets.map((asset) => asset.name).filter(Boolean),
  );

  return uniqueAssetNames.size || null;
};
