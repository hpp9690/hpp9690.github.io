(() => {
  const groups = [
    { id: "bank", label: "银行", preview: "银行股", aliases: "银行股 银行业", direct: "BK0475",
      industries: "0475" },
    { id: "consumer", label: "消费", preview: "零售百货 · 食品饮料 · 家电", aliases: "大消费 消费品 商业消费",
      featured: ["BK1655", "BK0825", "BK0665", "BK0896"],
      industries: "0482 1270 1268 1269 0484 1277 1279 1280 1278 1281 1282 1239 1240 1241 0440 1242 1243 1244 1245 1224 1225 1251 1252 0734 1266 1271 1272 0740 1273",
      themes: /零售|电商|消费(?!电子)|免税|百货|商超|餐饮|食品|旅游|酒店|饮料|白酒|酿酒|啤酒|调味|乳业|人造肉|预制菜|代糖|个护|化妆品|美容|玩具|盲盒|谷子|珠宝|钻石|家居|家电|婴童|养老|托育|教育|体育|露营|地摊|冰雪|内贸流通|超级品牌|社区团购|社交电商|内衣|服装|网红经济|文娱消费|首发经济|拼多多|小红书/ },
    { id: "health", label: "医疗", preview: "药品 · 中药 · 器械", aliases: "医药 医药医疗 医疗健康",
      featured: ["BK1106", "BK0615", "BK0668", "BK1763"],
      industries: "0465 1040 1044 1041 0727 1042 1253",
      themes: /医药|医疗|中药|制药|药品|创新药|减肥药|长寿药|特色药|医美|CRO|CAR.?T|DRG|DIP|SPD|抗体|单抗|疫苗|病毒防治|病原体防治|流感|阿兹海默|幽门|卫生|辅助生殖|蛋白|基因测序|诊断|肝炎|肝素|青蒿素|维生素|免疫治疗|神经|脑机接口|健康/ },
    { id: "electronics", label: "芯片电子", preview: "半导体 · PCB · 消费电子", aliases: "电子行业 芯片与电子",
      featured: ["BK0877", "BK0891", "BK1137", "BK1646"],
      industries: "1036 0459 1037 1038 1039 1223",
      themes: /半导体|芯片|PCB|光刻|存储|高带宽内存|先进封装|被动元件|光电子|感光|摄像|消费电子|AI手机|AIPC|AI眼镜|显示|OLED|LED|MLCC|EDA|IGBT|玻璃基板|电子纸|柔性屏|无线耳机|智能穿戴|苹果概念|小米概念|荣耀概念|华为海思|中芯概念|氮化镓|碳化硅|传感器|智能音箱|智能电视|蓝宝石|无线充电|射频|光波导/ },
    { id: "digital", label: "AI 与软件", preview: "AI应用 · 软件 · 通信", aliases: "人工智能与软件 科技软件",
      featured: ["BK1629", "BK0800", "BK1134", "BK1188"],
      industries: "0737 1238 0735 0448 0736 1218 1219 1220 1221 1222 1046",
      themes: /AI|人工智能|ChatGPT|DeepSeek|Kimi|MLOps|大模型|算力|云计算|国资云|东数西算|数据|软件|信创|网络安全|操作系统|鸿蒙|华为欧拉|通信|光纤|5G|6G|F5G|WiFi|UWB|IPv6|VPN|区块链|物联网|Web3|元宇宙|数字|虚拟现实|增强现实|空间计算|混合现实|裸眼3D|全息|超清视频|传媒|影视|短剧|游戏|电竞|电子竞技|出版|知识产权|抖音|快手|腾讯|百度|阿里|ERP|CPO|液冷服务器|铜缆|英伟达|华为昇腾|华为概念|互联网服务|边缘计算|量子科技|安防|智慧政务|电子身份证|生物识别/ },
    { id: "industry", label: "机器人与制造", preview: "机器人 · 机械装备 · 军工", aliases: "机械制造 装备制造 装备与军工",
      featured: ["BK1090", "BK1184", "BK1145", "BK1100"],
      industries: "1237 0545 0910 0739 1030 1236 1229 1232 1231 1230 1233",
      themes: /机器人|减速器|工业母机|工业互联网|机器视觉|高端装备|工程机械|PLC|3D打印|新型工业化|制造业|船舶制造|军工|军民融合|航母|航空航天|航天|大飞机|无人机|低空经济|飞行汽车|通用航空|空间站|卫星|海工装备|民爆|同步磁阻电机|交运设备/ },
    { id: "transport", label: "汽车与交通", preview: "整车 · 零部件 · 物流", aliases: "汽车产业 交通运输",
      industries: "1262 1264 0481 1016 1263 0450 0420 0421 0422",
      themes: /汽车|新能源车|车联网|车路云|车辆|电子车牌|智能驾驶|激光雷达|胎压|后视镜|ETC|EDR|轮毂|压铸|网约车|铁路|高铁|航运|快递|物流|公路|港口|整车|特斯拉/ },
    { id: "energy", label: "能源与电力", preview: "光伏 · 储能 · 油气煤炭", aliases: "新能源产业 能源电力",
      featured: ["BK0588", "BK0989", "BK0574", "BK0958"],
      industries: "0428 0457 1033 1031 1032 1034 1028 1250 1249 1274 1275 1276 1235 1234",
      themes: /新能源|光伏|风能|风电|储能|电池|电力|电网|电厂|超超临界|充电桩|高压快充|换电|超级电容|特高压|氢能|油气|石油|天然气|页岩气|可燃冰|煤化工|焦煤|核能|核电|核聚变|地热|发电|水电|抽水蓄能|污染|环保|固废|医废|土壤修复|垃圾分类|净水|碳交易|节能|热泵|尾气治理|锂矿|PVDF|集流体/ },
    { id: "materials", label: "资源与材料", preview: "有色金属 · 化工 · 钢铁", aliases: "资源材料 原材料 有色金属",
      industries: "1287 0732 1027 1015 1288 1226 1227 1228 1019 0538 0454 1018 0471 0546 1265 1267 1020",
      themes: /新材料|金属|稀土|稀缺资源|资源开采|黄金|冶金|钢铁|碳基|碳纤维|石墨烯|化工|氦气|工业气体|钛白粉|有机硅|染料|环氧丙烷|包装|印刷|造纸|焦炭|玻璃|塑料|PEEK|纳米银|抗菌面料|超导|合成生物/ },
    { id: "construction", label: "建筑与地产", preview: "地产 · 基建 · 装修建材", aliases: "房地产与建筑 房地产产业",
      industries: "0451 1045 1247 1246 0726 1248 0725 0476 0424",
      themes: /房地产|工程建设|地下管网|水利建设|海绵城市|房屋|装配建筑|建筑|城镇化|租售同权|REITs|PPP|智慧城市|智慧灯杆/ },
    { id: "finance", label: "证券与保险", preview: "券商 · 保险 · 多元金融", aliases: "非银金融 券商保险",
      industries: "0473 0474 0738",
      themes: /参股券商|参股保险|券商概念|期货概念|创投|互联网金融|蚂蚁金服|金融科技|跨境支付|移动支付|化债/ },
    { id: "agri", label: "农业", preview: "种植 · 养殖 · 饲料", aliases: "农林牧渔 农业种植与养殖",
      industries: "1261 1259 1258 1256 1257 1254 1255 1260 0731",
      themes: /农业|农机|农药兽药|种植|转基因|粮食|养殖|猪肉|鸡肉|水产|林业|乡村振兴|土地流转|宠物经济|植物照明|草甘膦|供销社|工业大麻/ },
    { id: "market", label: "市场主题", preview: "指数 · 地域 · 资金风格", aliases: "其他主题 指数风格",
      industries: "0539 1043" }
  ];
  const byIndustry = new Map(groups.flatMap((group) => group.industries.split(" ").map((code) => [`BK${code}`, group])));
  const fallback = groups.at(-1);
  const themePriority = ["health", "electronics", "industry", "transport", "energy", "materials",
    "construction", "finance", "agri", "digital", "consumer"].map((id) => groups.find((group) => group.id === id));
  const labels = { BK0482: "零售百货", BK1270: "专业连锁", BK1040: "中药", BK0475: "银行" };
  const aliases = {
    BK0482: "一般零售 百货 商超 超市 商贸零售",
    BK1270: "专业连锁 连锁零售",
    BK0465: "药品 制药 西药",
    BK1040: "中药 中成药",
    BK1041: "医疗设备 医疗器械",
    BK1042: "药店 医药流通",
    BK0475: "银行股 银行业"
  };
  const marketTheme = /^(昨[日天]|当日|近期|最近|历史|百日|破净|破发|退市|ST股|连续|密集调研|股权|[大小中微]盘|低价股|百元股|20\d{2}|上证\d|深证\d|中证\d|创业成份|创业板综|富时罗素|MSCI|沪股通|深股通|指数|转债|融资融券|长期破净)|持股|重仓|新进|金股|风格|增仓|减仓|估值|市盈率|市净率|破增发|参股银行|涨停表现/;
  const marketSections = [
    { id: "indices", label: "指数与风格", matches: /指数|上证|深证|中证|深成|MSCI|普尔|央视50|富时|创业成份|创业板综|HS300|风格|[大小中微]盘|权重|价[值格]股|高成长|周期股|红利|茅指数|宁组合|市盈|市净|中特估/ },
    { id: "places", label: "地域与政策", matches: /自贸|特区|新区|自由贸易|长江三角|京津冀|成渝|东北振兴|深圳|西部大开发|一带一路|国企改革|沪企改革|统一大市场|中俄贸易|海洋经济|政策|反内卷/ },
    { id: "owners", label: "资金与股东", matches: /持股|股权|举牌|重仓|新进|增仓|减仓|增持|参股|陆股通|沪股通|深股通|养老金|社保|做市|金股|重组|外资|融资融券/ },
    { id: "moves", label: "走势与财报", matches: /昨日|当日|近期|最近|历史|百日|[一二三四中季年]报|涨停|炸板|破发|破净|破增发|转亏|扭亏|亏损|首亏|新高|超跌|反转|低价股|百元股|热股|趋势股|低波/ },
    { id: "other", label: "其他" }
  ];

  function marketSection(board) {
    return (marketSections.find((section) => section.matches?.test(board.name)) || marketSections.at(-1)).id;
  }

  function forBoard(board) {
    if (board.kind === "industry") return byIndustry.get(board.code) || fallback;
    if (marketTheme.test(board.name)) return fallback;
    return groups.find((group) => group.featured?.includes(board.code)) ||
      themePriority.find((group) => group.themes.test(board.name)) || fallback;
  }

  function name(board) {
    return labels[board.code] || board.name.replace(/(?:Ⅱ|\sII)$/, "");
  }

  window.QuantBoardGroups = { groups, forBoard, name, marketSections, marketSection, aliases: (board) => aliases[board.code] || "" };
})();

