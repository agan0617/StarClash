/* 數值表：所有單位、建築、經濟、戰場幾何都在這裡，改平衡只改這個檔。
   距離單位是「格」(u)，時間是秒。戰場 22.5 × 30 格，玩家在下（y 小）、敵方在上（y 大）。
   三個種族（人類、蟲族、神族）共用同一套建設「角色」（礦工、補給、瓦斯、一二三階科技、升級），名稱與兵種各自不同。 */
'use strict';

const DATA = {
  VERSION: '0.5.0',
  TICK: 0.05,                 // 模擬固定每秒 20 步，和畫面更新分開
  FIELD: { w: 22.5, h: 30, river: 15, lanes: [5.5, 17], mid: 11.25 },
  DEPLOY_MAX_Y: 14,           // 玩家只能在 y ≤ 14 的自家半場放兵（敵方鏡射）
  MATCH_TIME: 240,            // 正規時間 4 分鐘
  OVERTIME: 60,               // 平手就進入 1 分鐘驟死戰
  DOUBLE_TIME: 90,            // 正規時間最後幾秒起（含驟死戰）礦與瓦斯收入加倍
  AGGRO: 6,                   // 單位主動找目標的範圍
  UNIT_RADIUS: 0.4,
  ZERG_REGEN: 1.5,            // 蟲族單位每秒回血（蟑螂另有 regen）
  SHIELD_REGEN: 4,            // 神族護盾每秒回復量（3 秒沒挨打才開始回）
  SHIELD_DELAY: 3,

  // 經濟（星海要素）：礦工挖礦、前 8 隻全速、9～16 隻半速（礦區飽和）；瓦斯要蓋瓦斯建築
  ECON: {
    startMinerals: 300, startGas: 0, startWorkers: 6, startSupply: 12,
    workerRate: 1.5, saturated: 8, saturatedRate: 0.75, maxWorkers: 16,
    gasRate: 2.0, maxRefinery: 2, maxSupply: 50,
  },

  // 基地建設（不放在戰場上，在面板按一下就開始蓋；蓋好才解鎖對應兵種）。key 是「角色」，三族共用；names 依種族
  BUILDS: {
    worker:   { m: 50,  g: 0,   t: 8,  max: 16, names: { terran: '礦工', zerg: '工蜂', protoss: '探測機' } },
    depot:    { m: 100, g: 0,   t: 12, max: 5,  names: { terran: '補給站', zerg: '王蟲', protoss: '水晶塔' } },
    refinery: { m: 75,  g: 0,   t: 15, max: 2,  names: { terran: '精煉廠', zerg: '萃取場', protoss: '瓦斯廠' } },
    barracks: { m: 150, g: 0,   t: 20, max: 1,  names: { terran: '兵營', zerg: '孵化池', protoss: '傳送門' } },
    factory:  { m: 150, g: 75,  t: 25, max: 1,  req: 'barracks', names: { terran: '重工廠', zerg: '蟑螂溫床', protoss: '機械台' } },
    starport: { m: 150, g: 75,  t: 25, max: 1,  req: 'factory',  names: { terran: '星港', zerg: '飛龍塔', protoss: '星門' } },
    upgrade:  { m: 100, g: 75,  t: 25, max: 3,  req: 'barracks', names: { terran: '武器升級', zerg: '攻擊升級', protoss: '武器升級' } },
  },
  BUILD_ORDER: ['worker', 'depot', 'refinery', 'barracks', 'factory', 'starport', 'upgrade'],

  // 種族：各自的 7 張兵種卡（最後一張是固定防禦建築）與特色
  RACES: {
    terran:  { name: '人類', cards: ['marine', 'marauder', 'hellion', 'tank', 'viking', 'banshee', 'turret'], trait: '兵種均衡、射程長，坦克能在塔外轟' },
    zerg:    { name: '蟲族', cards: ['zergling', 'baneling', 'roach', 'hydralisk', 'mutalisk', 'corruptor', 'spine'], trait: '便宜、量多、跑得快，所有單位會慢慢回血' },
    protoss: { name: '神族', cards: ['zealot', 'stalker', 'immortal', 'colossus', 'voidray', 'phoenix', 'cannon'], trait: '貴但耐打，護盾沒挨打 3 秒後會回滿' },
  },

  // 兵種（皇室戰爭要素）：拖卡片到自家半場就立刻出現，沒有生產時間；人口、礦、瓦斯夠才放得出來
  // armor：light 輕甲 / armored 重甲；bonusVs 對那種護甲多打 bonus；splash 對目標周圍的敵人也造成一半傷害（splashFull 全額）
  // hitsGround: false＝打不到地面單位（仍可以打塔）；count＝一張卡出幾隻；shield＝神族護盾；regen＝額外每秒回血；suicide＝撞上去自爆
  UNITS: {
    // ── 人類 ──
    marine:   { race: 'terran', name: '陸戰隊', m: 50,  g: 0,   supply: 1, hp: 45,  dmg: 6,  cd: 0.6,  range: 4,   speed: 2.0, air: false, hitsAir: true,  armor: 'light',   req: 'barracks', desc: '便宜、打得到空中，數量就是力量' },
    marauder: { race: 'terran', name: '掠奪者', m: 100, g: 25,  supply: 2, hp: 150, dmg: 10, bonus: 10, bonusVs: 'armored', cd: 1.0, range: 4.5, speed: 2.0, air: false, hitsAir: false, armor: 'armored', req: 'barracks', desc: '對重甲與建築多打一倍，打不到空中' },
    hellion:  { race: 'terran', name: '惡火',   m: 100, g: 0,   supply: 2, hp: 90,  dmg: 8,  bonus: 10, bonusVs: 'light',   cd: 1.2, range: 3.5, speed: 4.0, air: false, hitsAir: false, armor: 'light',   splash: 1.0, req: 'factory', desc: '跑得快、噴火範圍傷害，剋輕甲海' },
    tank:     { race: 'terran', name: '攻城坦克', m: 150, g: 125, supply: 3, hp: 200, dmg: 30, bonus: 15, bonusVs: 'armored', cd: 1.6, range: 7,  speed: 1.8, air: false, hitsAir: false, armor: 'armored', splash: 1.2, req: 'factory', desc: '射程最遠、拆塔最快，怕空中單位' },
    viking:   { race: 'terran', name: '維京',   m: 150, g: 75,  supply: 2, hp: 135, dmg: 12, bonus: 6,  bonusVs: 'armored', cd: 1.2, range: 6,   speed: 3.5, air: true,  hitsAir: true,  armor: 'armored', groundMul: 0.5, req: 'starport', desc: '空中單位、主力防空，打地面只有一半傷害' },
    banshee:  { race: 'terran', name: '女妖',   m: 150, g: 100, supply: 3, hp: 140, dmg: 24, cd: 1.25, range: 5,  speed: 3.5, air: true,  hitsAir: false, armor: 'light',   req: 'starport', desc: '空中轟炸，打不到空中' },
    turret:   { race: 'terran', name: '砲塔',   m: 100, g: 0,   supply: 0, hp: 250, dmg: 12, cd: 0.8,  range: 6,   speed: 0,   air: false, hitsAir: true,  armor: 'armored', structure: true, lifetime: 60, maxCount: 3, req: 'barracks', desc: '固定砲塔，打空也打地，撐 60 秒，最多 3 座' },
    // ── 蟲族：便宜、快、會回血 ──
    zergling: { race: 'zerg', name: '跳蟲',   m: 50,  g: 0,   supply: 0.5, count: 2, hp: 38, dmg: 5, cd: 0.5, range: 0.6, speed: 4.2, air: false, hitsAir: false, armor: 'light', req: 'barracks', desc: '一張卡兩隻，又快又便宜的近戰' },
    baneling: { race: 'zerg', name: '毒爆蟲', m: 50,  g: 25,  supply: 0.5, hp: 30,  dmg: 18, bonus: 18, bonusVs: 'light', cd: 1, range: 0.6, speed: 3.2, air: false, hitsAir: false, armor: 'light', splash: 1.6, splashFull: true, suicide: true, req: 'barracks', desc: '衝進敵群自爆，範圍傷害，剋輕甲海' },
    roach:    { race: 'zerg', name: '蟑螂',   m: 75,  g: 25,  supply: 2, hp: 145, dmg: 16, cd: 1.4, range: 4,   speed: 2.6, air: false, hitsAir: false, armor: 'armored', regen: 4, req: 'factory', desc: '耐打、回血很快的重甲，打不到空中' },
    hydralisk:{ race: 'zerg', name: '刺蛇',   m: 100, g: 50,  supply: 2, hp: 90,  dmg: 12, cd: 0.6, range: 5,   speed: 2.6, air: false, hitsAir: true,  armor: 'light',   req: 'factory', desc: '高輸出、打得到空中，但很脆' },
    mutalisk: { race: 'zerg', name: '飛龍',   m: 100, g: 100, supply: 2, hp: 100, dmg: 8,  cd: 1.0, range: 3,   speed: 4.2, air: true,  hitsAir: true,  armor: 'light',   splash: 0.9, req: 'starport', desc: '快速的空中騷擾，攻擊會彈跳' },
    corruptor:{ race: 'zerg', name: '腐化飛蟲', m: 150, g: 100, supply: 2, hp: 200, dmg: 14, bonus: 8, bonusVs: 'armored', cd: 1.0, range: 6, speed: 3.5, air: true, hitsAir: true, hitsGround: false, armor: 'armored', req: 'starport', desc: '專打空中（也能侵蝕塔），打不到地面單位' },
    spine:    { race: 'zerg', name: '脊刺觸手', m: 100, g: 0,  supply: 0, hp: 300, dmg: 18, bonus: 10, bonusVs: 'armored', cd: 1.2, range: 6, speed: 0, air: false, hitsAir: false, armor: 'armored', structure: true, lifetime: 60, maxCount: 3, req: 'barracks', desc: '固定防禦，很耐打但打不到空中，撐 60 秒' },
    // ── 神族：貴、硬、有護盾 ──
    zealot:   { race: 'protoss', name: '狂戰士', m: 100, g: 0,   supply: 2, hp: 100, shield: 70,  dmg: 16, cd: 1.2, range: 0.6, speed: 2.8, air: false, hitsAir: false, armor: 'light', req: 'barracks', desc: '近戰坦克，有護盾，打不到空中' },
    stalker:  { race: 'protoss', name: '追獵者', m: 125, g: 50,  supply: 2, hp: 85,  shield: 80,  dmg: 13, bonus: 5, bonusVs: 'armored', cd: 1.0, range: 6, speed: 3.0, air: false, hitsAir: true, armor: 'armored', req: 'barracks', desc: '射程長、打得到空中的萬用兵' },
    immortal: { race: 'protoss', name: '不朽者', m: 200, g: 100, supply: 4, hp: 250, shield: 150, dmg: 20, bonus: 30, bonusVs: 'armored', cd: 1.4, range: 5.5, speed: 2.2, air: false, hitsAir: false, armor: 'armored', req: 'factory', desc: '專拆重甲與塔，打不到空中' },
    colossus: { race: 'protoss', name: '巨像',   m: 250, g: 150, supply: 6, hp: 250, shield: 150, dmg: 14, bonus: 8, bonusVs: 'light', cd: 1.5, range: 6.5, speed: 2.0, air: false, hitsAir: false, armor: 'armored', splash: 1.4, splashFull: true, req: 'factory', desc: '長射程範圍光束，剋輕甲海' },
    voidray:  { race: 'protoss', name: '虛空輝光艦', m: 250, g: 150, supply: 4, hp: 150, shield: 100, dmg: 10, bonus: 6, bonusVs: 'armored', cd: 0.8, range: 5, speed: 3.0, air: true, hitsAir: true, armor: 'armored', req: 'starport', desc: '空中光束艦，打空也打地，專剋重甲' },
    phoenix:  { race: 'protoss', name: '鳳凰',   m: 150, g: 100, supply: 2, hp: 120, shield: 60,  dmg: 10, bonus: 6, bonusVs: 'light', cd: 0.8, range: 5, speed: 4.6, air: true, hitsAir: true, hitsGround: false, armor: 'light', req: 'starport', desc: '最快的戰機，專打空中（也能打塔）' },
    cannon:   { race: 'protoss', name: '光子砲', m: 150, g: 0,   supply: 0, hp: 150, shield: 150, dmg: 16, cd: 1.0, range: 6.5, speed: 0, air: false, hitsAir: true, armor: 'armored', structure: true, lifetime: 60, maxCount: 3, req: 'barracks', desc: '固定防禦，打空也打地，有護盾，撐 60 秒' },
  },
  CARD_ORDER: ['marine', 'marauder', 'hellion', 'tank', 'viking', 'banshee', 'turret'],   // 舊版相容：人類的卡

  // 塔（兩邊一樣）：兩座前哨塔守兩條路，主堡在最後
  TOWERS: {
    outpost: { name: '前哨塔', hp: 700,  dmg: 10, cd: 0.75, range: 6,   radius: 0.9 },
    main:    { name: '主堡',   hp: 1500, dmg: 13, cd: 0.75, range: 7,   radius: 1.2 },
  },
  TOWER_POS: { outpostY: 6, mainY: 2 },   // 玩家側；敵方 y 鏡射（h - y）

  // 電腦對手：收入倍率、思考間隔、會不會針對玩家的兵種出剋制兵、礦工目標數、存多少礦才推一波（wave＋每秒 waveGrow）
  AI: {
    easy:   { name: '簡單', income: 0.7,  think: 1.5, counter: false, workers: 10, wave: 250, waveGrow: 0.5 },
    normal: { name: '普通', income: 1.0,  think: 0.8, counter: true,  workers: 12, wave: 250, waveGrow: 0.5 },
    hard:   { name: '困難', income: 1.25, think: 0.5, counter: true,  workers: 14, wave: 300, waveGrow: 0.5 },
  },
};
// 建設名稱依種族
DATA.buildName = (what, race) => DATA.BUILDS[what].names[race || 'terran'];
