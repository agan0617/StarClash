/* 數值表：所有單位、建築、經濟、戰場幾何都在這裡，改平衡只改這個檔。
   距離單位是「格」(u)，時間是秒。戰場 22.5 × 30 格，玩家在下（y 小）、敵方在上（y 大）。 */
'use strict';

const DATA = {
  VERSION: '0.2.0',
  TICK: 0.05,                 // 模擬固定每秒 20 步，和畫面更新分開
  FIELD: { w: 22.5, h: 30, river: 15, lanes: [5.5, 17], mid: 11.25 },
  DEPLOY_MAX_Y: 14,           // 玩家只能在 y ≤ 14 的自家半場放兵（敵方鏡射）
  MATCH_TIME: 300,            // 正規時間 5 分鐘
  OVERTIME: 60,               // 平手就進入 1 分鐘驟死戰
  AGGRO: 6,                   // 單位主動找目標的範圍
  UNIT_RADIUS: 0.4,

  // 經濟（星海要素）：礦工挖礦、前 8 隻全速、9～16 隻半速（礦區飽和）；瓦斯要蓋精煉廠
  ECON: {
    startMinerals: 300, startGas: 0, startWorkers: 6, startSupply: 12,
    workerRate: 1.0, saturated: 8, saturatedRate: 0.5, maxWorkers: 16,
    gasRate: 2.0, maxRefinery: 2, maxSupply: 50,
  },

  // 基地建設（不放在戰場上，在面板按一下就開始蓋；蓋好才解鎖對應兵種）
  BUILDS: {
    worker:   { name: '礦工',   m: 50,  g: 0,   t: 8,  max: 16, desc: '多一隻礦工，礦收入 +1/秒（第 9 隻起 +0.5）' },
    depot:    { name: '補給站', m: 100, g: 0,   t: 12, max: 5,  desc: '人口上限 +8（最多 50）' },
    refinery: { name: '精煉廠', m: 75,  g: 0,   t: 15, max: 2,  desc: '瓦斯 +2/秒（最多 2 座）' },
    barracks: { name: '兵營',   m: 150, g: 0,   t: 20, max: 1,  desc: '解鎖陸戰隊、掠奪者、砲塔' },
    factory:  { name: '重工廠', m: 150, g: 75,  t: 25, max: 1,  req: 'barracks', desc: '解鎖惡火、攻城坦克' },
    starport: { name: '星港',   m: 150, g: 75,  t: 25, max: 1,  req: 'factory',  desc: '解鎖維京、女妖' },
    upgrade:  { name: '武器升級', m: 100, g: 75,  t: 25, max: 3, req: 'barracks', desc: '全軍攻擊 +10%，可升 3 級' },
  },
  BUILD_ORDER: ['worker', 'depot', 'refinery', 'barracks', 'factory', 'starport', 'upgrade'],

  // 兵種（皇室戰爭要素）：點卡片、點自家半場就立刻出現，沒有生產時間；人口、礦、瓦斯夠才放得出來
  // armor：light 輕甲 / armored 重甲；bonusVs 對那種護甲多打 bonus；splash 對目標周圍的敵人也造成一半傷害
  UNITS: {
    marine:   { name: '陸戰隊', icon: '陸', m: 50,  g: 0,   supply: 1, hp: 45,  dmg: 6,  cd: 0.6,  range: 4,   speed: 2.0, air: false, hitsAir: true,  armor: 'light',   req: 'barracks', desc: '便宜、打得到空中，數量就是力量' },
    marauder: { name: '掠奪者', icon: '掠', m: 100, g: 25,  supply: 2, hp: 125, dmg: 10, bonus: 10, bonusVs: 'armored', cd: 1.0, range: 4.5, speed: 2.0, air: false, hitsAir: false, armor: 'armored', req: 'barracks', desc: '對重甲與建築多打一倍，打不到空中' },
    hellion:  { name: '惡火',   icon: '火', m: 100, g: 0,   supply: 2, hp: 90,  dmg: 8,  bonus: 6,  bonusVs: 'light',   cd: 1.2, range: 3.5, speed: 4.0, air: false, hitsAir: false, armor: 'light',   splash: 1.0, req: 'factory', desc: '跑得快、噴火範圍傷害，剋陸戰隊海' },
    tank:     { name: '攻城坦克', icon: '坦', m: 150, g: 125, supply: 3, hp: 175, dmg: 20, bonus: 15, bonusVs: 'armored', cd: 1.4, range: 7,  speed: 1.8, air: false, hitsAir: false, armor: 'armored', splash: 0.8, req: 'factory', desc: '射程最遠、拆塔最快，怕空中單位' },
    viking:   { name: '維京',   icon: '維', m: 150, g: 75,  supply: 2, hp: 135, dmg: 12, bonus: 6,  bonusVs: 'armored', cd: 1.2, range: 6,   speed: 3.5, air: true,  hitsAir: true,  armor: 'armored', req: 'starport', desc: '空中單位，空對空、空對地都行' },
    banshee:  { name: '女妖',   icon: '妖', m: 150, g: 100, supply: 3, hp: 140, dmg: 24, cd: 1.25, range: 5,  speed: 3.5, air: true,  hitsAir: false, armor: 'light',   req: 'starport', desc: '空中轟炸，只有陸戰隊、維京、砲塔打得到它' },
    turret:   { name: '砲塔',   icon: '砲', m: 100, g: 0,   supply: 0, hp: 250, dmg: 12, cd: 0.8,  range: 6,   speed: 0,   air: false, hitsAir: true,  armor: 'armored', structure: true, lifetime: 60, maxCount: 3, req: 'barracks', desc: '放在自家半場的固定砲塔，撐 60 秒，最多 3 座' },
  },
  CARD_ORDER: ['marine', 'marauder', 'hellion', 'tank', 'viking', 'banshee', 'turret'],

  // 塔（兩邊一樣）：兩座前哨塔守兩條路，主堡在最後
  TOWERS: {
    outpost: { name: '前哨塔', hp: 1000, dmg: 14, cd: 0.75, range: 6.5, radius: 0.9 },
    main:    { name: '主堡',   hp: 2000, dmg: 18, cd: 0.75, range: 7,   radius: 1.2 },
  },
  TOWER_POS: { outpostY: 6, mainY: 2 },   // 玩家側；敵方 y 鏡射（h - y）

  // 電腦對手：收入倍率、思考間隔、會不會針對玩家的兵種出剋制兵、礦工目標數、存多少礦才推一波
  AI: {
    easy:   { name: '簡單', income: 0.7,  think: 1.5, counter: false, workers: 10, wave: 250 },
    normal: { name: '普通', income: 1.0,  think: 0.8, counter: true,  workers: 12, wave: 300 },
    hard:   { name: '困難', income: 1.25, think: 0.5, counter: true,  workers: 14, wave: 350 },
  },
};
