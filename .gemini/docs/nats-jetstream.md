# NATS JetStream အကြောင်း

NATS JetStream ဆိုတာ NATS ရဲ့ နောက်မျိုးဆက် persistence engine တစ်ခုဖြစ်ပြီး၊ စိတ်ချရပြီး စွမ်းဆောင်ရည်မြင့်မားတဲ့ message queue စနစ်တစ်ခု ဖြစ်ပါတယ်။ သူက ပုံမှန် NATS ရဲ့ "ပို့ပြီးရင်ပြီးရော" (fire-and-forget) စနစ်ကို ကျော်လွန်ပြီး message တွေကို သိမ်းဆည်းထားနိုင်ခြင်း (persistence)၊ သေချာပေါက် ရောက်ရှိစေခြင်း (delivery guarantees) နဲ့ message စီးဆင်းမှု (streaming) လုပ်ဆောင်ချက်တွေကို ဖြည့်ဆည်းပေးပါတယ်။

## အဓိက အယူအဆများ (Core Concepts)

### ၁။ Streams (စမ်းချောင်းများ)
**Stream** ဆိုတာ သတ်မှတ်ထားတဲ့ Subjects တွေပေါ်ကနေ ရောက်လာတဲ့ message တွေကို သိမ်းဆည်းထားတဲ့ နေရာ ဖြစ်ပါတယ်။ သူက message တွေကို ရောက်လာတဲ့ အစီအစဉ်အတိုင်း သိမ်းဆည်းထားပေးပါတယ်။
- **Retention Policy:** Message တွေကို ဘယ်လောက်ကြာကြာ သိမ်းထားမလဲ၊ အရွယ်အစား ဘယ်လောက်ထိ သိမ်းမလဲ ဆိုတာ သတ်မှတ်နိုင်ပါတယ်။
- **Storage:** Memory ထဲမှာဖြစ်စေ၊ Hard Disk (File storage) ထဲမှာဖြစ်စေ သိမ်းဆည်းနိုင်ပါတယ်။

### ၂။ Subjects (ခေါင်းစဉ်များ)
**Subjects** ဆိုတာ message တွေ ပို့ရမယ့် လိပ်စာတွေ ဖြစ်ပါတယ်။ ဥပမာ - `whatsapp.commands.1.234` (ဒီမှာ `1` က company ID ဖြစ်ပြီး `234` က connection ID ဖြစ်ပါတယ်)။

### ၃။ Consumers (အသုံးပြုသူများ)
**Consumer** ဆိုတာ Stream ထဲမှာ ရှိနေတဲ့ message တွေကို ဖတ်ရှုသူ ဖြစ်ပါတယ်။ ဘယ် message တွေကို ဖတ်ပြီးပြီလဲ၊ ဘယ်ဟာတွေ ကျန်သေးလဲ ဆိုတာကို သူက မှတ်သားထားပေးပါတယ်။
- **Push Consumers:** NATS ကနေ message တွေကို ဖတ်မယ့်သူဆီ တိုက်ရိုက် ပို့ပေးတာပါ။
- **Pull Consumers:** ဖတ်မယ့်သူက အဆင်ပြေတဲ့အချိန်ကျမှ NATS ဆီကနေ message တွေကို လှမ်းတောင်းတာ (pull) ပါ။
- **Durable Consumers:** ဖတ်တဲ့သူက ခေတ္တလိုင်းပြတ်သွားရင်တောင် သူနောက်ဆုံး ဘယ်နားအထိ ဖတ်ထားလဲဆိုတာကို NATS က မှတ်မိနေတဲ့ စနစ်ပါ။

## ဒီ Project မှာ JetStream ကို ဘာကြောင့် သုံးတာလဲ

### ၁။ စိတ်ချရတဲ့ ပို့ဆောင်မှု (Reliable Delivery)
ပုံမှန် NATS နဲ့မတူတာက JetStream ဟာ WhatsApp worker service တွေ ခေတ္တ ပိတ်ထားရတဲ့ အချိန်မျိုးမှာတောင် "Send Message" လိုမျိုး command တွေကို ပျောက်မသွားအောင် သိမ်းထားပေးနိုင်ပါတယ်။ Service ပြန်တက်လာတဲ့အခါ ကျန်နေတဲ့ command တွေကို ပြန်ဖတ်နိုင်ပါတယ်။

### ၂။ အနည်းဆုံး တစ်ကြိမ် ရောက်ရှိစေခြင်း (At-Least-Once Delivery)
JetStream မှာ အကြောင်းပြန်ကြားချက် (`ACK`) စနစ် ပါဝင်ပါတယ်။ Message တစ်ခုကို process လုပ်တာ မအောင်မြင်ရင် JetStream က အဲဒီ message ကို နောက်တစ်ကြိမ် ထပ်ပို့ပေးမှာ ဖြစ်တဲ့အတွက် အရေးကြီးတဲ့ လုပ်ဆောင်ချက်တွေ မလွတ်သွားအောင် လုပ်ဆောင်ပေးပါတယ်။

### ၃။ တစ်ခုနဲ့တစ်ခု ချိတ်ဆက်မှု လျှော့ချခြင်း (Decoupling)
Hono API ကနေ command တစ်ခု ပို့လိုက်တဲ့အခါ Go service က အဆင်သင့် ဖြစ်မဖြစ် စောင့်နေစရာ မလိုပါဘူး။ Stream ထဲကို ပို့လိုက်ရုံပါပဲ။ Go service က အားတဲ့အချိန်ကျမှ အဲဒီ command ကို ယူပြီး လုပ်ဆောင်သွားမှာ ဖြစ်ပါတယ်။

## နည်းပညာဆိုင်ရာ အသေးစိတ် (Implementation Details)

- **Port:** `4222` (NATS Protocol)
- **Monitoring:** `8222` (HTTP Monitoring)
- **Library (Go):** `github.com/nats-io/nats.go`
- **Library (Node.js):** `nats` (NPM)

ဒီ codebase ထဲမှာ `orchestrator` service က လိုအပ်တဲ့ Streams နဲ့ Consumers တွေကို စတင်ချိန်မှာ တည်ဆောက်ပေးပါတယ်။