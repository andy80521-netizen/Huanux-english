import { Mic2, Medal, Award, Crown, Ear, Trophy, Wand2, LucideIcon } from 'lucide-react';

export interface VocabItem {
  id: number;
  course: string;
  question: string;
  answer: string;
  phonetic: string;
  type: string;
  mastery: number;
  listeningMastery: number;
  isHidden: boolean;
}

export const INITIAL_COURSES = ["口說練習", "澳式口說"];

export const INITIAL_DATA: VocabItem[] = [
  {
    id: 1,
    course: "口說練習",
    question: "澳大利亞作為一個多元文化的國家",
    answer: "Australia, being a multicultural country",
    phonetic: "/əˈstreɪliə/ /ˌbiːɪŋ/ /ə/ /ˌmʌltiˈkʌltʃərəl/ /ˈkʌntri/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 2,
    course: "口說練習",
    question: "是來自世界各地移民的家園",
    answer: "is home to immigrants from all over the world",
    phonetic: "/ɪz/ /həʊm/ /tu/ /ˈɪmɪɡrənts/ /frɒm/ /ɔːl/ /ˈəʊvə/ /ðə/ /wɜːld/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 3,
    course: "澳式口說",
    question: "一杯茶或咖啡",
    answer: "Cuppa",
    phonetic: "/ˈkʌpə/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 4,
    course: "澳式口說",
    question: "閒聊",
    answer: "Chinwag",
    phonetic: "/ˈtʃɪnwæɡ/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 5,
    course: "澳式口說",
    question: "雞 / 烤雞",
    answer: "Chook",
    phonetic: "/tʃʊk/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 6,
    course: "澳式口說",
    question: "三明治",
    answer: "Sanga",
    phonetic: "/ˈsæŋə/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 7,
    course: "澳式口說",
    question: "讚啦 / 傳奇人物 (稱讚人)",
    answer: "Legend",
    phonetic: "/ˈledʒənd/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 8,
    course: "澳式口說",
    question: "壓力很大 / 忙翻了",
    answer: "Under the pump",
    phonetic: "/ˈʌndə ðə pʌmp/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 9,
    course: "澳式口說",
    question: "忙得不可開交 / 跑斷腿",
    answer: "Run off my feet",
    phonetic: "/rʌn ɒf maɪ fiːt/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 10,
    course: "澳式口說",
    question: "太過分 / 耍人 / 開玩笑",
    answer: "Taking the piss",
    phonetic: "/ˈteɪkɪŋ ðə pɪs/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 11,
    course: "澳式口說",
    question: "收斂一點 / 安分點",
    answer: "Pull his head in",
    phonetic: "/pʊl hɪz hed ɪn/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 12,
    course: "澳式口說",
    question: "完全沒機會",
    answer: "Buckley's chance",
    phonetic: "/ˈbʌkliz tʃɑːns/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 13,
    course: "澳式口說",
    question: "數落 / 斥責 (某人)",
    answer: "Have a crack (at someone)",
    phonetic: "/hæv ə kræk/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 14,
    course: "澳式口說",
    question: "搞砸了",
    answer: "Stuffed up",
    phonetic: "/stʌft ʌp/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 15,
    course: "澳式口說",
    question: "關係很鐵 / 很好",
    answer: "Tight",
    phonetic: "/taɪt/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 16,
    course: "澳式口說",
    question: "失控的人 / 瘋瘋癲癲的人",
    answer: "Loose unit",
    phonetic: "/luːs ˈjuːnɪt/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 17,
    course: "澳式口說",
    question: "喝酒 / 喝醉",
    answer: "On the piss",
    phonetic: "/ɒn ðə pɪs/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 18,
    course: "澳式口說",
    question: "大口吃吧 (把這塞進嘴裡)",
    answer: "Wrap your laughing gear around that",
    phonetic: "/ræp jɔː ˈlɑːfɪŋ ɡɪə əˈraʊnd ðæt/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 19,
    course: "澳式口說",
    question: "太棒了 / 水啦",
    answer: "You beauty",
    phonetic: "/juː ˈbjuːti/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 20,
    course: "澳式口說",
    question: "澳式足球",
    answer: "Footy",
    phonetic: "/ˈfʊti/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 21,
    course: "澳式口說",
    question: "下午",
    answer: "Arvo",
    phonetic: "/ˈɑːvəʊ/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 22,
    course: "澳式口說",
    question: "擠爆了 / 滿滿的",
    answer: "Chokkas",
    phonetic: "/ˈtʃɒkəz/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 23,
    course: "澳式口說",
    question: "電視",
    answer: "Telly",
    phonetic: "/ˈteli/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 24,
    course: "澳式口說",
    question: "氣死 / 嘔死 / 超不爽",
    answer: "Spewing",
    phonetic: "/ˈspjuːɪŋ/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 25,
    course: "澳式口說",
    question: "下班 / 收工",
    answer: "Knock off",
    phonetic: "/nɒk ɒf/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 26,
    course: "澳式口說",
    question: "裝病請假",
    answer: "Chuck a sickie",
    phonetic: "/tʃʌk ə ˈsɪki/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 27,
    course: "澳式口說",
    question: "氣氛嗨翻天 / 熱鬧",
    answer: "Going off",
    phonetic: "/ˈɡəʊɪŋ ɒf/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 28,
    course: "澳式口說",
    question: "獲勝 / 贏球",
    answer: "Get up",
    phonetic: "/ɡet ʌp/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 29,
    course: "澳式口說",
    question: "離開 / 走人",
    answer: "Head off",
    phonetic: "/hed ɒf/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 30,
    course: "澳式口說",
    question: "餅乾",
    answer: "Bikkie",
    phonetic: "/ˈbɪki/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 31,
    course: "澳式口說",
    question: "臨走前最後一份 / 路上吃",
    answer: "One for the road",
    phonetic: "/wʌn fɔː ðə rəʊd/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 32,
    course: "澳式口說",
    question: "Cup of tea or coffee",
    answer: "Cuppa",
    phonetic: "/ˈkʌpə/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 33,
    course: "澳式口說",
    question: "Chat / Conversation",
    answer: "Chinwag",
    phonetic: "/ˈtʃɪnwæɡ/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 34,
    course: "澳式口說",
    question: "Chicken",
    answer: "Chook",
    phonetic: "/tʃʊk/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 35,
    course: "澳式口說",
    question: "Sandwich",
    answer: "Sanga",
    phonetic: "/ˈsæŋə/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 36,
    course: "澳式口說",
    question: "A great person / Thanks",
    answer: "Legend",
    phonetic: "/ˈledʒənd/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 37,
    course: "澳式口說",
    question: "Under pressure / Very busy",
    answer: "Under the pump",
    phonetic: "/ˈʌndə ðə pʌmp/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 38,
    course: "澳式口說",
    question: "Extremely busy / Rushed",
    answer: "Run off my feet",
    phonetic: "/rʌn ɒf maɪ fiːt/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 39,
    course: "澳式口說",
    question: "Being unreasonable / Mocking",
    answer: "Taking the piss",
    phonetic: "/ˈteɪkɪŋ ðə pɪs/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 40,
    course: "澳式口說",
    question: "Stop acting annoying or arrogant",
    answer: "Pull his head in",
    phonetic: "/pʊl hɪz hed ɪn/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 41,
    course: "澳式口說",
    question: "No chance at all",
    answer: "Buckley's chance",
    phonetic: "/ˈbʌkliz tʃɑːns/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 42,
    course: "澳式口說",
    question: "To scold or criticize someone",
    answer: "Have a crack (at someone)",
    phonetic: "/hæv ə kræk/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 43,
    course: "澳式口說",
    question: "Made a mistake / Ruined",
    answer: "Stuffed up",
    phonetic: "/stʌft ʌp/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 44,
    course: "澳式口說",
    question: "Close friends",
    answer: "Tight",
    phonetic: "/taɪt/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 45,
    course: "澳式口說",
    question: "Unpredictable or crazy person",
    answer: "Loose unit",
    phonetic: "/luːs ˈjuːnɪt/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 46,
    course: "澳式口說",
    question: "Drinking alcohol",
    answer: "On the piss",
    phonetic: "/ɒn ðə pɪs/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 47,
    course: "澳式口說",
    question: "Eat this (Put in your mouth)",
    answer: "Wrap your laughing gear around that",
    phonetic: "/ræp jɔː ˈlɑːfɪŋ ɡɪə əˈraʊnd ðæt/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 48,
    course: "澳式口說",
    question: "Great / Beautiful (Exclamation of joy)",
    answer: "You beauty",
    phonetic: "/juː ˈbjuːti/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 49,
    course: "澳式口說",
    question: "Football (Australian Rules Football)",
    answer: "Footy",
    phonetic: "/ˈfʊti/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 50,
    course: "澳式口說",
    question: "Afternoon",
    answer: "Arvo",
    phonetic: "/ˈɑːvəʊ/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 51,
    course: "澳式口說",
    question: "Full / Crowded",
    answer: "Chokkas",
    phonetic: "/ˈtʃɒkəz/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 52,
    course: "澳式口說",
    question: "Television",
    answer: "Telly",
    phonetic: "/ˈteli/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 53,
    course: "澳式口說",
    question: "Very angry / Disappointed",
    answer: "Spewing",
    phonetic: "/ˈspjuːɪŋ/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 54,
    course: "澳式口說",
    question: "Finish work",
    answer: "Knock off",
    phonetic: "/nɒk ɒf/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 55,
    course: "澳式口說",
    question: "Call in sick when fine",
    answer: "Chuck a sickie",
    phonetic: "/tʃʌk ə ˈsɪki/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 56,
    course: "澳式口說",
    question: "Lively / Exciting",
    answer: "Going off",
    phonetic: "/ˈɡəʊɪŋ ɒf/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 57,
    course: "澳式口說",
    question: "Win a game",
    answer: "Get up",
    phonetic: "/ɡet ʌp/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 58,
    course: "澳式口說",
    question: "Leave / Go away",
    answer: "Head off",
    phonetic: "/hed ɒf/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 59,
    course: "澳式口說",
    question: "Biscuit / Cookie",
    answer: "Bikkie",
    phonetic: "/ˈbɪki/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 60,
    course: "澳式口說",
    question: "A final drink or snack before leaving",
    answer: "One for the road",
    phonetic: "/wʌn fɔː ðə rəʊd/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 61,
    course: "澳式口說",
    question: "妳想進來喝杯茶嗎？",
    answer: "Do you want to come in for a cuppa?",
    phonetic: "/du/ /ju/ /wɒnt/ /tu/ /kʌm/ /ɪn/ /fɔː/ /ə/ /ˈkʌpə/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 62,
    course: "澳式口說",
    question: "不用了沒事，我快餓死了，我正要去買點午餐。",
    answer: "All good, I'm starving. I'm going to go get some lunch.",
    phonetic: "/ɔːl/ /ɡʊd/, /aɪm/ /ˈstɑːvɪŋ/. /aɪm/ /ˈɡəʊɪŋ/ /tu/ /ɡəʊ/ /ɡet/ /sʌm/ /lʌntʃ/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 63,
    course: "澳式口說",
    question: "進來聊聊天吧，我有烤雞，我給妳做個三明治。",
    answer: "Come in for a chinwag. I've got a roast chook. I'll make you a sanga.",
    phonetic: "/kʌm/ /ɪn/ /fɔː/ /ə/ /ˈtʃɪnwæɡ/. /aɪv/ /ɡɒt/ /ə/ /rəʊst/ /tʃʊk/. /aɪl/ /meɪk/ /ju/ /ə/ /ˈsæŋə/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 64,
    course: "澳式口說",
    question: "太讚了（傳奇人物），聽起來不錯。",
    answer: "Legend, sounds good.",
    phonetic: "/ˈledʒənd/, /saʊndz/ /ɡʊd/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 65,
    course: "澳式口說",
    question: "所以，妳最近好嗎？",
    answer: "So how are you going?",
    phonetic: "/səʊ/ /haʊ/ /ɑː/ /ju/ /ˈɡəʊɪŋ/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 66,
    course: "澳式口說",
    question: "我最近工作壓力很大，忙得不可開交。",
    answer: "I've been under the pump at work, run off my feet lately.",
    phonetic: "/aɪv/ /biːn/ /ˈʌndə/ /ðə/ /pʌmp/ /æt/ /wɜːk/, /rʌn/ /ɒf/ /maɪ/ /fiːt/ /ˈleɪtli/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 67,
    course: "澳式口說",
    question: "我老闆已經連續三天叫我加班了。",
    answer: "My boss has asked me to do overtime three days in a row now.",
    phonetic: "/maɪ/ /bɒs/ /hæz/ /ɑːskt/ /mi/ /tu/ /du/ /ˈəʊvətaɪm/ /θriː/ /deɪz/ /ɪn/ /ə/ /rəʊ/ /naʊ/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 68,
    course: "澳式口說",
    question: "我是不介意多賺點錢，但他如果再叫我加班，我就要告訴他這太過分了（別把他當傻子耍）。",
    answer: "I mean, I don't mind the extra cash but if he asks me to do it again, I'll tell him he's taking the piss.",
    phonetic: "/aɪ/ /miːn/, /aɪ/ /dəʊnt/ /maɪnd/ /ðə/ /ˈekstrə/ /kæʃ/ /bʌt/ /ɪf/ /hi/ /ɑːsks/ /mi/ /tu/ /du/ /ɪt/ /əˈɡen/, /aɪl/ /tel/ /hɪm/ /hiz/ /ˈteɪkɪŋ/ /ðə/ /pɪs/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 69,
    course: "澳式口說",
    question: "是啊，叫他收斂一點（別鬧了）。",
    answer: "Yeah, tell him to pull his head in.",
    phonetic: "/jeə/, /tel/ /hɪm/ /tu/ /pʊl/ /hɪz/ /hed/ /ɪn/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 70,
    course: "澳式口說",
    question: "那是不可能發生的（機會渺茫）！",
    answer: "There's Buckley's chance of that happening!",
    phonetic: "/ðeəz/ /ˈbʌkliz/ /tʃɑːns/ /ɒv/ /ðæt/ /ˈhæpənɪŋ/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 71,
    course: "澳式口說",
    question: "我經理這週也因為我拒絕額外的輪班而數落了我一頓！",
    answer: "My manager had a crack at me too this week for refusing extra shifts!",
    phonetic: "/maɪ/ /ˈmænɪdʒə/ /hæd/ /ə/ /kræk/ /æt/ /mi/ /tuː/ /ðɪs/ /wiːk/ /fɔː/ /rɪˈfjuːzɪŋ/ /ˈekstrə/ /ʃɪfts/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 72,
    course: "澳式口說",
    question: "其實那是她的錯，是她把排班表搞砸的。",
    answer: "It was her fault actually. She was the one who stuffed up the roster.",
    phonetic: "/ɪt/ /wɒz/ /hɜː/ /fɔːlt/ /ˈæktʃuəli/. /ʃi/ /wɒz/ /ðə/ /wʌn/ /huː/ /stʌft/ /ʌp/ /ðə/ /ˈrɒstə/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 73,
    course: "澳式口說",
    question: "我以為妳和妳老闆交情很鐵（很好）。",
    answer: "I thought you and your boss were tight.",
    phonetic: "/aɪ/ /θɔːt/ /ju/ /ænd/ /jɔː/ /bɒs/ /wɜː/ /taɪt/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 74,
    course: "澳式口說",
    question: "我們是不錯，但她有時候有點失控（瘋癲），特別是她喝醉的時候。",
    answer: "We are but she can be a bit of a loose unit, especially when she's on the piss.",
    phonetic: "/wi/ /ɑː/ /bʌt/ /ʃi/ /kæn/ /bi/ /ə/ /bɪt/ /ɒv/ /ə/ /luːs/ /ˈjuːnɪt/, /ɪˈspeʃəli/ /wen/ /ʃiz/ /ɒn/ /ðə/ /pɪs/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 75,
    course: "澳式口說",
    question: "來吧，大口吃吧（把這個塞進妳的嘴巴裡）。",
    answer: "There you go, wrap your laughing gear around that.",
    phonetic: "/ðeə/ /ju/ /ɡəʊ/, /ræp/ /jɔː/ /ˈlɑːfɪŋ/ /ɡɪə/ /əˈraʊnd/ /ðæt/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 76,
    course: "澳式口說",
    question: "水啦（太棒了），這看起來真不錯，正是我需要的。",
    answer: "You beauty, this looks great, just what I needed.",
    phonetic: "/juː/ /ˈbjuːti/, /ðɪs/ /lʊks/ /ɡreɪt/, /dʒʌst/ /wɒt/ /aɪ/ /ˈniːdɪd/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 77,
    course: "澳式口說",
    question: "所以妳今天下午要去看球賽（澳式足球）嗎？",
    answer: "So are you going to the footy this arvo?",
    phonetic: "/səʊ/ /ɑː/ /ju/ /ˈɡəʊɪŋ/ /tu/ /ðə/ /ˈfʊti/ /ðɪs/ /ˈɑːvəʊ/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 78,
    course: "澳式口說",
    question: "不了，我不想進城。那裡肯定擠爆了，到處都是人！",
    answer: "Nah, I don't want to go into town. It'll be chokkas, people everywhere!",
    phonetic: "/nɑː/, /aɪ/ /dəʊnt/ /wɒnt/ /tu/ /ɡəʊ/ /ˈɪntu/ /taʊn/. /ɪtl/ /bi/ /ˈtʃɒkəz/, /ˈpiːpl/ /ˈevriweə/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 79,
    course: "澳式口說",
    question: "我就打算在電視上看比賽。妳呢？",
    answer: "I'm just going to watch the game on telly. What about you?",
    phonetic: "/aɪm/ /dʒʌst/ /ˈɡəʊɪŋ/ /tu/ /wɒtʃ/ /ðə/ /ɡeɪm/ /ɒn/ /ˈteli/. /wɒt/ /əˈbaʊt/ /ju/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 80,
    course: "澳式口說",
    question: "不了，我晚點還得工作。錯過比賽讓我氣死了（超不爽）。",
    answer: "Nah, I've got to work later. I'm spewing I'll miss it.",
    phonetic: "/nɑː/, /aɪv/ /ɡɒt/ /tu/ /wɜːk/ /ˈleɪtə/. /aɪm/ /ˈspjuːɪŋ/ /aɪl/ /mɪs/ /ɪt/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 81,
    course: "澳式口說",
    question: "應該會是一場精彩的比賽。",
    answer: "Should be a good game.",
    phonetic: "/ʃʊd/ /bi/ /ə/ /ɡʊd/ /ɡeɪm/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 82,
    course: "澳式口說",
    question: "我可能會試著早點下班，看看能不能趕上看下半場。",
    answer: "I might try and knock off early and see if I can watch the second half.",
    phonetic: "/aɪ/ /maɪt/ /traɪ/ /ænd/ /nɒk/ /ɒf/ /ˈɜːli/ /ænd/ /siː/ /ɪf/ /aɪ/ /kæn/ /wɒtʃ/ /ðə/ /ˈsekənd/ /hɑːf/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 83,
    course: "澳式口說",
    question: "乾脆裝病請假算了！",
    answer: "Just chuck a sickie!",
    phonetic: "/dʒʌst/ /tʃʌk/ /ə/ /ˈsɪki/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 84,
    course: "澳式口說",
    question: "如果我裝病請假，妳得跟我一起進城！",
    answer: "If I pull a sickie, you're coming with me into town!",
    phonetic: "/ɪf/ /aɪ/ /pʊl/ /ə/ /ˈsɪki/, /jʊə/ /ˈkʌmɪŋ/ /wɪð/ /mi/ /ˈɪntu/ /taʊn/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 85,
    course: "澳式口說",
    question: "如果 Doggies 隊贏了，現場氣氛肯定會嗨翻天！",
    answer: "It'll be going off if the doggies get up!",
    phonetic: "/ɪtl/ /bi/ /ˈɡəʊɪŋ/ /ɒf/ /ɪf/ /ðə/ /ˈdɒɡiz/ /ɡet/ /ʌp/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 86,
    course: "澳式口說",
    question: "總之，我該走了。謝啦，三明治很好吃。",
    answer: "Anyway, I'd better head off. Thanks for the sanga.",
    phonetic: "/ˈeniweɪ/, /aɪd/ /ˈbetə/ /hed/ /ɒf/. /θæŋks/ /fɔː/ /ðə/ /ˈsæŋə/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 87,
    course: "澳式口說",
    question: "妳要來塊餅乾嗎？",
    answer: "You want a bikkie?",
    phonetic: "/ju/ /wɒnt/ /ə/ /ˈbɪki/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  },
  {
    id: 88,
    course: "澳式口說",
    question: "好啊，我帶一塊路上吃，謝啦！",
    answer: "Yeah, I'll take one for the road, thanks!",
    phonetic: "/jeə/, /aɪl/ /teɪk/ /wʌn/ /fɔː/ /ðə/ /rəʊd/, /θæŋks/",
    type: "Q&A",
    mastery: 0,
    listeningMastery: 0,
    isHidden: false
  }
];

export interface BadgeLevel {
  name: string;
  threshold: number;
  color: string;
  bg: string;
  border: string;
  gradient: string;
  icon: LucideIcon;
  barColor: string;
  ring: string;
  shadow: string;
  glow?: string;
  tier?: string;
}

export const BADGE_LEVELS: BadgeLevel[] = [
    { 
        name: '口說菜鳥', 
        threshold: 0, 
        color: 'text-slate-400 dark:text-slate-500', 
        bg: 'bg-slate-50 dark:bg-slate-800', 
        border: 'border-slate-200 dark:border-slate-700', 
        gradient: 'from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900', 
        icon: Mic2, 
        barColor: 'bg-slate-200 dark:bg-slate-700',
        ring: 'ring-slate-100 dark:ring-slate-700',
        shadow: 'shadow-none',
        tier: 'rookie'
    },
    { 
        name: '高手勳章', 
        threshold: 1000, 
        color: 'text-emerald-600 dark:text-emerald-400', 
        bg: 'bg-emerald-50 dark:bg-emerald-900/20', 
        border: 'border-emerald-200 dark:border-emerald-800', 
        gradient: 'from-emerald-400 via-teal-100 to-emerald-50 dark:from-emerald-900 dark:via-emerald-900/50 dark:to-slate-900', 
        barColor: 'bg-gradient-to-r from-emerald-500 to-teal-400', 
        icon: Medal, 
        ring: 'ring-emerald-100 dark:ring-emerald-900', 
        glow: 'drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]',
        shadow: 'shadow-emerald-100 dark:shadow-none',
        tier: 'master'
    },
    { 
        name: '專家勳章', 
        threshold: 4000, 
        color: 'text-violet-600 dark:text-violet-400', 
        bg: 'bg-violet-50 dark:bg-violet-900/20', 
        border: 'border-violet-200 dark:border-violet-800', 
        gradient: 'from-violet-400 via-purple-100 to-fuchsia-50 dark:from-violet-900 dark:via-purple-900/50 dark:to-slate-900', 
        barColor: 'bg-gradient-to-r from-violet-600 to-fuchsia-500', 
        icon: Award, 
        ring: 'ring-violet-100 dark:ring-violet-900', 
        glow: 'drop-shadow-[0_0_10px_rgba(139,92,246,0.6)]',
        shadow: 'shadow-violet-200 dark:shadow-none',
        tier: 'expert'
    },
    { 
        name: '大師勳章', 
        threshold: 10000, 
        color: 'text-rose-700 dark:text-rose-400', 
        bg: 'bg-rose-50 dark:bg-rose-900/20', 
        border: 'border-rose-200 dark:border-rose-800', 
        gradient: 'from-rose-500 via-red-200 to-orange-50 dark:from-rose-900 dark:via-red-900/50 dark:to-slate-900', 
        barColor: 'bg-gradient-to-r from-rose-600 via-red-500 to-orange-500', 
        icon: Crown, 
        ring: 'ring-rose-200 dark:ring-rose-900', 
        glow: 'drop-shadow-[0_0_12px_rgba(244,63,94,0.7)]',
        shadow: 'shadow-rose-300 dark:shadow-none',
        tier: 'grandmaster'
    },
];

export const LISTENING_BADGE_LEVELS: BadgeLevel[] = [
    { 
        name: '聽力菜雞', 
        threshold: 0, 
        color: 'text-slate-400 dark:text-slate-500', 
        bg: 'bg-slate-50 dark:bg-slate-800', 
        border: 'border-slate-200 dark:border-slate-700', 
        gradient: 'from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900', 
        icon: Ear, 
        barColor: 'bg-slate-200 dark:bg-slate-700',
        ring: 'ring-slate-100 dark:ring-slate-700',
        shadow: 'shadow-none',
        tier: 'rookie'
    },
    { 
        name: '順風耳獎盃', 
        threshold: 500, 
        color: 'text-sky-600 dark:text-sky-400', 
        bg: 'bg-sky-50 dark:bg-sky-900/20', 
        border: 'border-sky-200 dark:border-sky-800', 
        gradient: 'from-sky-400 via-cyan-100 to-blue-50 dark:from-sky-900 dark:via-cyan-900/50 dark:to-slate-900', 
        barColor: 'bg-gradient-to-r from-sky-400 to-blue-500', 
        icon: Trophy, 
        ring: 'ring-sky-100 dark:ring-sky-900', 
        glow: 'drop-shadow-[0_0_8px_rgba(14,165,233,0.5)]',
        shadow: 'shadow-sky-100 dark:shadow-none',
        tier: 'master'
    },
    { 
        name: '諦聽者獎盃', 
        threshold: 2000, 
        color: 'text-indigo-600 dark:text-indigo-400', 
        bg: 'bg-indigo-50 dark:bg-indigo-900/20', 
        border: 'border-indigo-200 dark:border-indigo-800', 
        gradient: 'from-indigo-400 via-blue-100 to-slate-50 dark:from-indigo-900 dark:via-blue-900/50 dark:to-slate-900', 
        barColor: 'bg-gradient-to-r from-indigo-500 to-blue-600', 
        icon: Trophy, 
        ring: 'ring-indigo-100 dark:ring-indigo-900', 
        glow: 'drop-shadow-[0_0_10px_rgba(79,70,229,0.6)]',
        shadow: 'shadow-indigo-200 dark:shadow-none',
        tier: 'expert'
    },
    { 
        name: '天聽神獎盃', 
        threshold: 5000, 
        color: 'text-amber-600 dark:text-amber-400', 
        bg: 'bg-amber-50 dark:bg-amber-900/20', 
        border: 'border-amber-200 dark:border-amber-800', 
        gradient: 'from-amber-400 via-yellow-100 to-orange-50 dark:from-amber-900 dark:via-yellow-900/50 dark:to-slate-900', 
        barColor: 'bg-gradient-to-r from-amber-500 via-yellow-500 to-orange-500', 
        icon: Trophy, 
        ring: 'ring-amber-100 dark:ring-amber-900', 
        glow: 'drop-shadow-[0_0_15px_rgba(245,158,11,0.8)]',
        shadow: 'shadow-amber-300 dark:shadow-none',
        tier: 'grandmaster'
    },
];

export const GOD_LEVELS: BadgeLevel[] = [
    { 
        name: '語神權杖', 
        threshold: 0, 
        color: 'text-yellow-600 dark:text-yellow-400', 
        bg: 'bg-yellow-50 dark:bg-yellow-900/20', 
        border: 'border-yellow-200 dark:border-yellow-700', 
        gradient: 'from-yellow-400 via-amber-300 to-orange-100 dark:from-yellow-700 dark:via-amber-800 dark:to-slate-900', 
        barColor: 'bg-gradient-to-r from-yellow-500 via-amber-500 to-orange-600', 
        icon: Wand2, 
        ring: 'ring-yellow-200 dark:ring-yellow-800', 
        glow: 'drop-shadow-[0_0_20px_rgba(234,179,8,0.9)] scale-110',
        shadow: 'shadow-yellow-400 dark:shadow-yellow-900/50',
        tier: 'god'
    }
];