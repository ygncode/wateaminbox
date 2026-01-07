# AWS Lambda နှင့် NATS JetStream ပေါင်းစပ်အသုံးပြုခြင်း

AWS Lambda ကို NATS နဲ့ တွဲသုံးပြီး scale လုပ်တဲ့အခါမှာ အခြား messaging services (ဥပမာ - SQS) တွေနဲ့မတူတဲ့ အချက်အချို့ ရှိပါတယ်။

## ၁။ Lambda ကို Publisher အဖြစ် အသုံးပြုခြင်း (Lambda -> NATS)
Lambda function တစ်ခုခုကနေ လုပ်ဆောင်ချက်ပြီးဆုံးသွားတဲ့အခါ NATS ဆီကို message လှမ်းပို့တာ (Publish လုပ်တာ) က အလွန်လွယ်ကူပါတယ်။
- **အသုံးပြုပုံ:** Lambda ထဲမှာ NATS client ကို သုံးပြီး message ပို့လိုက်ရုံပါပဲ။
- **သတိပြုရန်:** Lambda ဟာ ခေတ္တခဏပဲ အလုပ်လုပ်တာ ဖြစ်လို့ message ပို့ပြီးတာနဲ့ connection ကို စနစ်တကျ ပြန်ပိတ်ဖို့ (Close လုပ်ဖို့) လိုပါတယ်။

## ၂။ NATS ကနေ Lambda ကို Trigger ပေးခြင်း (NATS -> Lambda)
AWS မှာ NATS အတွက် တိုက်ရိုက် Native Trigger မရှိသေးပါဘူး။ ဒါကြောင့် နည်းလမ်း (၂) ခုထဲက တစ်ခုကို သုံးရပါမယ်။
- **နည်းလမ်း (က) - Bridge Service သုံးခြင်း:** EC2 သို့မဟုတ် Fargate ပေါ်မှာ အမြဲတမ်း run နေတဲ့ small service (Go သို့မဟုတ် Node.js) တစ်ခု ထားရှိရပါမယ်။ သူက NATS ကနေ message တွေကို ဖတ်ပြီး Lambda ကို `Invoke` လုပ်ပေးမှာ ဖြစ်ပါတယ်။
- **နည်းလမ်း (ခ) - NATS-to-Lambda Adapter:** NATS community က ထုတ်ထားတဲ့ official adapter တွေကို သုံးပြီး NATS subjects တွေကို Lambda functions တွေနဲ့ ချိတ်ဆက်ပေးနိုင်ပါတယ်။

## ၃။ Scaling အားသာချက်များ
- **Massive Parallelism:** Message တွေ အများကြီး တစ်ပြိုင်နက် ဝင်လာတဲ့အခါ Lambda က အလိုအလျောက် ပွားပြီး (scale out ဖြစ်ပြီး) အားလုံးကို တစ်ပြိုင်နက် process လုပ်ပေးနိုင်ပါတယ်။
- **Cost Efficiency:** Message ရှိတဲ့ အချိန်မှပဲ Lambda က အလုပ်လုပ်တာ ဖြစ်လို့ server အမြဲတမ်း ဖွင့်ထားစရာ မလိုဘဲ ပိုက်ဆံ ချွေတာနိုင်ပါတယ်။

## ၄။ စိန်ခေါ်မှုများနှင့် ဖြေရှင်းနည်းများ (Challenges)
- **Connection Overhead:** Lambda တက်လာတိုင်း NATS connection အသစ် ပြန်ဆောက်နေရရင် ကြာချိန် (latency) ရှိနိုင်ပါတယ်။ ဒါကို ဖြေရှင်းဖို့ `Global scope` မှာ connection ကို တည်ဆောက်ပြီး ပြန်လည်အသုံးပြု (reuse) ရပါမယ်။
- **Cold Starts:** Lambda အသုံးနည်းတဲ့ အချိန်မှာ ပထမဆုံး အကြိမ် ပြန်တက်လာရင် နည်းနည်း နှေးနိုင်ပါတယ်။
- **NATS Connection Limits:** Lambda တွေ ထောင်နဲ့ချီပြီး တစ်ပြိုင်နက် တက်လာရင် NATS server ရဲ့ connection အကန့်အသတ်ကို ထိနိုင်ပါတယ်။ ဒါကြောင့် NATS server ကို cluster အကြီးကြီး ဆောက်ထားဖို့ လိုပါတယ်။

## အနှစ်ချုပ်
Lambda နဲ့ NATS ကို တွဲသုံးခြင်းက **အလွန်မြန်ဆန်တဲ့ (Real-time) processing** လိုအပ်တဲ့ နေရာတွေမှာ အလွန်ထိရောက်ပါတယ်။ ဒါပေမယ့် NATS ကနေ Lambda ကို trigger လုပ်ဖို့အတွက် ကြားခံ (Bridge/Adapter) တစ်ခုတော့ လိုအပ်မှာ ဖြစ်ပါတယ်။
