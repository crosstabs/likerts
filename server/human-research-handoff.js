import { createHash } from 'node:crypto';
import { languageScriptReport } from './language-script.js';
import { humanResearchPackageHashes } from './human-research-lifecycle.js';

export const HUMAN_RESEARCH_HANDOFF_VERSION = 'human-research-handoff-v1';
export const HUMAN_RESEARCH_BOUNDARY = 'Human research handoff—planning materials only. Likerts has not recruited, screened, contacted, or surveyed anyone. Sample size, incidence, feasibility, timing, and cost remain planning estimates until confirmed by a researcher and provider.';

const COPY = {
  en: {
    title: 'Human research questionnaire draft', consent: 'Do you consent to take part in this research under the privacy information provided by the researcher?', yes: 'Yes', no: 'No', influence: 'What most influenced your answer?', conceptInstruction: 'Please review the following concept.', comprehension: 'In your own words, what does this concept or offer provide?', objections: 'What concerns, objections, or missing information would affect your decision?', category: (category, horizon) => `Do you expect to make or influence a decision about ${category} ${horizon.toLowerCase()}?`, recent: (category) => `Please describe your recent experience with ${category}.`, alternative: 'What would you most likely do instead?', value: 'How does the value of this offer compare with your current alternative?', purchaseBarrier: 'What would most prevent you from purchasing this exact offer?', close: 'Thank you. Your responses will be analyzed as observed human research, separately from the synthetic study.',
    likelihood: ['Very unlikely', 'Unlikely', 'Not sure', 'Likely', 'Very likely'], purchase: ['Definitely would not', 'Probably would not', 'Might or might not', 'Probably would', 'Definitely would'],
  },
  es: {
    title: 'Borrador de cuestionario para investigación con personas', consent: '¿Acepta participar en esta investigación conforme a la información de privacidad facilitada por el investigador?', yes: 'Sí', no: 'No', influence: '¿Qué influyó más en su respuesta?', conceptInstruction: 'Revise el siguiente concepto.', comprehension: 'Con sus propias palabras, ¿qué ofrece este concepto o esta oferta?', objections: '¿Qué dudas, objeciones o información faltante influirían en su decisión?', category: (category, horizon) => `¿Espera tomar o influir en una decisión sobre ${category} ${horizon.toLowerCase()}?`, recent: (category) => `Describa su experiencia reciente con ${category}.`, alternative: '¿Qué haría con mayor probabilidad en su lugar?', value: '¿Cómo se compara el valor de esta oferta con su alternativa actual?', purchaseBarrier: '¿Qué le impediría principalmente comprar esta oferta exacta?', close: 'Gracias. Sus respuestas se analizarán como investigación humana observada, por separado del estudio sintético.',
    likelihood: ['Muy improbable', 'Improbable', 'No lo sé', 'Probable', 'Muy probable'], purchase: ['Definitivamente no compraría', 'Probablemente no compraría', 'Quizá sí o quizá no', 'Probablemente compraría', 'Definitivamente compraría'],
  },
  pt: {
    title: 'Rascunho de questionário para pesquisa com pessoas', consent: 'Você concorda em participar desta pesquisa de acordo com as informações de privacidade fornecidas pelo pesquisador?', yes: 'Sim', no: 'Não', influence: 'O que mais influenciou sua resposta?', conceptInstruction: 'Analise o conceito a seguir.', comprehension: 'Com suas próprias palavras, o que este conceito ou oferta oferece?', objections: 'Quais preocupações, objeções ou informações ausentes afetariam sua decisão?', category: (category, horizon) => `Você espera tomar ou influenciar uma decisão sobre ${category} ${horizon.toLowerCase()}?`, recent: (category) => `Descreva sua experiência recente com ${category}.`, alternative: 'O que você provavelmente faria como alternativa?', value: 'Como o valor desta oferta se compara à sua alternativa atual?', purchaseBarrier: 'O que mais impediria você de comprar esta oferta exata?', close: 'Obrigado. Suas respostas serão analisadas como pesquisa humana observada, separadamente do estudo sintético.',
    likelihood: ['Muito improvável', 'Improvável', 'Não tenho certeza', 'Provável', 'Muito provável'], purchase: ['Definitivamente não compraria', 'Provavelmente não compraria', 'Talvez comprasse ou não', 'Provavelmente compraria', 'Definitivamente compraria'],
  },
  fr: {
    title: 'Projet de questionnaire pour une étude auprès de personnes', consent: 'Acceptez-vous de participer à cette étude conformément aux informations de confidentialité fournies par le chercheur ?', yes: 'Oui', no: 'Non', influence: 'Qu’est-ce qui a le plus influencé votre réponse ?', conceptInstruction: 'Veuillez examiner le concept suivant.', comprehension: 'Avec vos propres mots, que propose ce concept ou cette offre ?', objections: 'Quelles préoccupations, objections ou informations manquantes influenceraient votre décision ?', category: (category, horizon) => `Prévoyez-vous de prendre ou d’influencer une décision concernant ${category} ${horizon.toLowerCase()} ?`, recent: (category) => `Décrivez votre expérience récente avec ${category}.`, alternative: 'Que feriez-vous le plus probablement à la place ?', value: 'Comment la valeur de cette offre se compare-t-elle à votre solution actuelle ?', purchaseBarrier: 'Qu’est-ce qui vous empêcherait le plus d’acheter cette offre précise ?', close: 'Merci. Vos réponses seront analysées comme une étude humaine observée, séparément de l’étude synthétique.',
    likelihood: ['Très improbable', 'Improbable', 'Incertain', 'Probable', 'Très probable'], purchase: ['Je n’achèterais certainement pas', 'Je n’achèterais probablement pas', 'Peut-être oui, peut-être non', 'J’achèterais probablement', 'J’achèterais certainement'],
  },
  de: {
    title: 'Fragebogenentwurf für Forschung mit Menschen', consent: 'Stimmen Sie der Teilnahme an dieser Studie gemäß den Datenschutzinformationen der Forschenden zu?', yes: 'Ja', no: 'Nein', influence: 'Was hat Ihre Antwort am stärksten beeinflusst?', conceptInstruction: 'Bitte prüfen Sie das folgende Konzept.', comprehension: 'Was bietet dieses Konzept oder Angebot in Ihren eigenen Worten?', objections: 'Welche Bedenken, Einwände oder fehlenden Informationen würden Ihre Entscheidung beeinflussen?', category: (category, horizon) => `Erwarten Sie, ${horizon.toLowerCase()} eine Entscheidung zu ${category} zu treffen oder zu beeinflussen?`, recent: (category) => `Beschreiben Sie Ihre jüngsten Erfahrungen mit ${category}.`, alternative: 'Was würden Sie stattdessen am ehesten tun?', value: 'Wie schätzen Sie den Wert dieses Angebots im Vergleich zu Ihrer derzeitigen Alternative ein?', purchaseBarrier: 'Was würde Sie am ehesten davon abhalten, genau dieses Angebot zu kaufen?', close: 'Vielen Dank. Ihre Antworten werden als beobachtete Forschung mit Menschen getrennt von der synthetischen Studie ausgewertet.',
    likelihood: ['Sehr unwahrscheinlich', 'Unwahrscheinlich', 'Unsicher', 'Wahrscheinlich', 'Sehr wahrscheinlich'], purchase: ['Würde ich definitiv nicht kaufen', 'Würde ich wahrscheinlich nicht kaufen', 'Vielleicht, vielleicht nicht', 'Würde ich wahrscheinlich kaufen', 'Würde ich definitiv kaufen'],
  },
  zh: {
    title: '真人研究问卷草案', consent: '您是否同意根据研究者提供的隐私说明参加本研究？', yes: '是', no: '否', influence: '什么因素对您的回答影响最大？', conceptInstruction: '请阅读以下概念。', comprehension: '请用您自己的话说明这一概念或方案提供了什么。', objections: '哪些顾虑、异议或缺失信息会影响您的决定？', category: (category, horizon) => `您预计会在${horizon}就${category}作出决定或影响相关决定吗？`, recent: (category) => `请描述您最近与${category}相关的经历。`, alternative: '如果不选择该方案，您最可能怎么做？', value: '与您目前的替代方案相比，该方案的价值如何？', purchaseBarrier: '什么最可能阻止您购买这一确切方案？', close: '谢谢。您的回答将作为真实参与者研究单独分析，与合成研究分开。',
    likelihood: ['非常不可能', '不太可能', '不确定', '可能', '非常可能'], purchase: ['肯定不会购买', '可能不会购买', '不确定是否购买', '可能会购买', '肯定会购买'],
  },
  ja: {
    title: '実参加者調査用アンケート草案', consent: '研究者が提示するプライバシー情報に基づき、この調査への参加に同意しますか？', yes: 'はい', no: 'いいえ', influence: '回答に最も影響したことは何ですか？', conceptInstruction: '次のコンセプトをご確認ください。', comprehension: 'このコンセプトまたは提案が何を提供するものか、ご自身の言葉で説明してください。', objections: '判断に影響する懸念、反対理由、不足情報は何ですか？', category: (category, horizon) => `${horizon}に${category}について決定する、または決定に関与する見込みはありますか？`, recent: (category) => `${category}に関する最近の経験を説明してください。`, alternative: '代わりに何をする可能性が最も高いですか？', value: 'この提案の価値は現在の代替手段と比べてどうですか？', purchaseBarrier: 'この提案を購入しない最大の理由は何ですか？', close: 'ありがとうございました。回答は合成研究とは分けて、実参加者による調査データとして分析されます。',
    likelihood: ['まったく可能性がない', '可能性が低い', 'わからない', '可能性が高い', '非常に可能性が高い'], purchase: ['絶対に購入しない', 'おそらく購入しない', 'どちらともいえない', 'おそらく購入する', '絶対に購入する'],
  },
  ko: {
    title: '실제 참여자 연구 설문 초안', consent: '연구자가 제공한 개인정보 안내에 따라 이 연구에 참여하는 데 동의하십니까?', yes: '예', no: '아니요', influence: '응답에 가장 큰 영향을 준 요인은 무엇입니까?', conceptInstruction: '다음 콘셉트를 검토해 주세요.', comprehension: '이 콘셉트나 제안이 무엇을 제공하는지 본인의 말로 설명해 주세요.', objections: '결정에 영향을 줄 우려, 반대 이유 또는 부족한 정보는 무엇입니까?', category: (category, horizon) => `${horizon}에 ${category} 관련 결정을 내리거나 영향을 줄 것으로 예상하십니까?`, recent: (category) => `${category}에 대한 최근 경험을 설명해 주세요.`, alternative: '대신 무엇을 할 가능성이 가장 높습니까?', value: '이 제안의 가치는 현재 대안과 비교해 어떻습니까?', purchaseBarrier: '이 정확한 제안을 구매하지 않게 만드는 가장 큰 요인은 무엇입니까?', close: '감사합니다. 응답은 합성 연구와 분리하여 실제 참여자 연구로 분석됩니다.',
    likelihood: ['전혀 가능성 없음', '가능성 낮음', '잘 모르겠음', '가능성 높음', '매우 가능성 높음'], purchase: ['절대 구매하지 않음', '아마 구매하지 않음', '구매할 수도 있고 아닐 수도 있음', '아마 구매함', '반드시 구매함'],
  },
  ar: {
    title: 'مسودة استبيان لبحث مع مشاركين حقيقيين', consent: 'هل توافق على المشاركة في هذا البحث وفق معلومات الخصوصية التي يقدمها الباحث؟', yes: 'نعم', no: 'لا', influence: 'ما العامل الأكثر تأثيراً في إجابتك؟', conceptInstruction: 'يرجى مراجعة المفهوم التالي.', comprehension: 'اشرح بكلماتك ما الذي يقدمه هذا المفهوم أو العرض.', objections: 'ما المخاوف أو الاعتراضات أو المعلومات الناقصة التي قد تؤثر في قرارك؟', category: (category, horizon) => `هل تتوقع اتخاذ قرار بشأن ${category} أو التأثير فيه ${horizon}؟`, recent: (category) => `صف تجربتك الأخيرة مع ${category}.`, alternative: 'ما الخيار الذي سترجح بدلاً منه؟', value: 'كيف تقارن قيمة هذا العرض ببديلك الحالي؟', purchaseBarrier: 'ما العامل الأهم الذي قد يمنعك من شراء هذا العرض المحدد؟', close: 'شكراً لك. ستحلل إجاباتك كبحث بشري مرصود بصورة منفصلة عن الدراسة التركيبية.',
    likelihood: ['غير محتمل إطلاقاً', 'غير محتمل', 'غير متأكد', 'محتمل', 'محتمل جداً'], purchase: ['بالتأكيد لن أشتري', 'على الأرجح لن أشتري', 'قد أشتري وقد لا أشتري', 'على الأرجح سأشتري', 'بالتأكيد سأشتري'],
  },
  hi: {
    title: 'वास्तविक प्रतिभागी शोध के लिए प्रश्नावली का मसौदा', consent: 'क्या आप शोधकर्ता द्वारा दी गई गोपनीयता जानकारी के अनुसार इस शोध में भाग लेने के लिए सहमत हैं?', yes: 'हाँ', no: 'नहीं', influence: 'आपके उत्तर को सबसे अधिक किस बात ने प्रभावित किया?', conceptInstruction: 'कृपया नीचे दिए गए कॉन्सेप्ट की समीक्षा करें।', comprehension: 'अपने शब्दों में बताइए कि यह कॉन्सेप्ट या प्रस्ताव क्या देता है।', objections: 'कौन-सी चिंताएँ, आपत्तियाँ या अधूरी जानकारी आपके निर्णय को प्रभावित करेंगी?', category: (category, horizon) => `क्या आप ${horizon} ${category} के बारे में निर्णय लेने या उसे प्रभावित करने की अपेक्षा करते हैं?`, recent: (category) => `${category} के साथ अपने हाल के अनुभव का वर्णन करें।`, alternative: 'इसके बजाय आप सबसे अधिक संभावना से क्या करेंगे?', value: 'इस प्रस्ताव का मूल्य आपके मौजूदा विकल्प की तुलना में कैसा है?', purchaseBarrier: 'इस सटीक प्रस्ताव को खरीदने से आपको सबसे अधिक क्या रोकेगा?', close: 'धन्यवाद। आपके उत्तरों का विश्लेषण संश्लेषित अध्ययन से अलग, वास्तविक प्रतिभागी शोध के रूप में किया जाएगा।',
    likelihood: ['बिल्कुल संभावना नहीं', 'संभावना कम', 'निश्चित नहीं', 'संभावना है', 'बहुत अधिक संभावना'], purchase: ['निश्चित रूप से नहीं खरीदूँगा', 'शायद नहीं खरीदूँगा', 'शायद खरीदूँ या न खरीदूँ', 'शायद खरीदूँगा', 'निश्चित रूप से खरीदूँगा'],
  },
};

const PRIMARY_COPY = {
  en: { conceptPrimary: 'How likely would you be to consider using or adopting this concept?', purchasePrimary: (horizon) => `If this exact offer were available under the conditions shown, how likely would you be to purchase it ${horizon.toLowerCase()}?` },
  es: { conceptPrimary: '¿Qué probabilidad habría de que considerara usar o adoptar este concepto?', purchasePrimary: (horizon) => `Si esta oferta exacta estuviera disponible en las condiciones mostradas, ¿qué probabilidad habría de que la comprara ${horizon.toLowerCase()}?` },
  pt: { conceptPrimary: 'Qual seria a probabilidade de você considerar usar ou adotar este conceito?', purchasePrimary: (horizon) => `Se esta oferta exata estivesse disponível nas condições apresentadas, qual seria a probabilidade de você comprá-la ${horizon.toLowerCase()}?` },
  fr: { conceptPrimary: 'Quelle serait la probabilité que vous envisagiez d’utiliser ou d’adopter ce concept ?', purchasePrimary: (horizon) => `Si cette offre exacte était disponible dans les conditions présentées, quelle serait la probabilité que vous l’achetiez ${horizon.toLowerCase()} ?` },
  de: { conceptPrimary: 'Wie wahrscheinlich wäre es, dass Sie die Nutzung oder Einführung dieses Konzepts erwägen?', purchasePrimary: (horizon) => `Wenn dieses genaue Angebot zu den gezeigten Bedingungen verfügbar wäre, wie wahrscheinlich wäre ein Kauf ${horizon.toLowerCase()}?` },
  zh: { conceptPrimary: '您考虑使用或采用这一概念的可能性有多大？', purchasePrimary: (horizon) => `如果这一确切方案按所示条件提供，您在${horizon}购买它的可能性有多大？` },
  ja: { conceptPrimary: 'このコンセプトの利用または採用を検討する可能性はどの程度ありますか？', purchasePrimary: (horizon) => `この提案が提示された条件どおりに利用できる場合、${horizon}に購入する可能性はどの程度ありますか？` },
  ko: { conceptPrimary: '이 콘셉트의 사용 또는 도입을 고려할 가능성은 어느 정도입니까?', purchasePrimary: (horizon) => `이 제안이 제시된 조건대로 제공된다면 ${horizon}에 구매할 가능성은 어느 정도입니까?` },
  ar: { conceptPrimary: 'ما مدى احتمال أن تفكر في استخدام هذا المفهوم أو اعتماده؟', purchasePrimary: (horizon) => `إذا كان هذا العرض المحدد متاحاً بالشروط المعروضة، فما مدى احتمال شرائه ${horizon}؟` },
  hi: { conceptPrimary: 'आपके इस कॉन्सेप्ट का उपयोग या इसे अपनाने पर विचार करने की कितनी संभावना है?', purchasePrimary: (horizon) => `यदि यही प्रस्ताव दिखाई गई शर्तों पर उपलब्ध हो, तो आपके इसे ${horizon} खरीदने की कितनी संभावना है?` },
};

const METHOD_COPY = {
  en: {
    methodTitles: { GENERAL_LIKERT: 'Human research questionnaire draft', CONCEPT_TEST: 'Draft human concept-test questionnaire', PURCHASE_INTENT: 'Draft human purchase-intent questionnaire', MESSAGE_TEST: 'Draft human message-test questionnaire', CLAIMS_TEST: 'Draft human claims-test questionnaire', UX_EXPECTATION_TEST: 'Draft human UX-expectation questionnaire', FEATURE_PRIORITIZATION: 'Draft human feature-prioritization exercise', BRAND_POSITIONING: 'Draft human brand-positioning questionnaire', PRICE_SENSITIVITY: 'Draft human price-sensitivity questionnaire', SURVEY_PRETEST: 'Draft cognitive-pretest guide', INTERVIEW_GUIDE: 'Draft human interview guide' },
    offerInstruction: 'Please review the following offer exactly as shown.', messageInstruction: 'Please review the following message exactly as shown.', claimInstruction: 'Please review the following claim exactly as shown.', uxInstruction: 'Please review the following task scenario and experience description.', featureInstruction: 'Please review the following feature set exactly as shown.', brandInstruction: 'Please review the following brands and attributes exactly as shown.', priceInstruction: 'Please review the following offer and price points exactly as shown.', surveyPretestInstruction: 'Please review each supplied survey question exactly as shown.', interviewIntro: 'Moderator opening: confirm consent, privacy expectations, recording status, accessibility needs, and the right to stop before asking topic questions.',
    messagePrimary: (intendedAction) => `How compelling is this message for the intended action: ${intendedAction}?`, claimPrimary: () => 'How believable is this claim as presented?', uxPrimary: (userGoal) => `How easy or difficult do you expect it would be to accomplish this goal: ${userGoal}?`, featurePrimary: (selectionConstraint) => `Rank these features under this constraint: ${selectionConstraint}.`, brandPrimary: (category) => `For each supplied attribute, which brand in ${category} do you most associate with that attribute?`, pricePrimary: (purchaseHorizon) => `For each supplied price, how likely would you be to purchase the exact offer ${purchaseHorizon.toLowerCase()}?`, surveyPretestPrimary: 'For each supplied survey question, what did you think the question was asking and what made it hard to answer?', topicPrompt: (topic) => `Tell me about ${topic}.`,
    claimClarity: 'What is unclear, overstated, or in need of substantiation?', uxFriction: 'What would make this task easier or harder?', featureReason: 'What trade-offs most influenced your ranking?', brandReason: 'What associations or experiences drove your choices?', priceReason: 'What changed across the supplied prices, and what most influenced your answers?', surveyPretestProbe: 'Which words, assumptions, scales, or recall periods should the researcher revise?', interviewClose: 'Is there anything else the researcher should understand before closing?', sensitiveAreas: (areas) => `Moderator note: handle these sensitive areas carefully and let the participant skip any of them: ${areas.join('; ')}.`,
    messageScale: ['Not at all compelling', 'Slightly compelling', 'Neither compelling nor unconvincing', 'Compelling', 'Very compelling'], claimScale: ['Not at all believable', 'Slightly believable', 'Neither believable nor unbelievable', 'Believable', 'Very believable'], easeScale: ['Very difficult', 'Difficult', 'Neither difficult nor easy', 'Easy', 'Very easy'],
  },
  es: {
    methodTitles: { GENERAL_LIKERT: 'Borrador de cuestionario para investigación con personas', CONCEPT_TEST: 'Borrador de cuestionario de prueba de concepto', PURCHASE_INTENT: 'Borrador de cuestionario de intención de compra', MESSAGE_TEST: 'Borrador de cuestionario de prueba de mensaje', CLAIMS_TEST: 'Borrador de cuestionario de prueba de afirmación', UX_EXPECTATION_TEST: 'Borrador de cuestionario de expectativa de UX', FEATURE_PRIORITIZATION: 'Borrador de ejercicio de priorización de funciones', BRAND_POSITIONING: 'Borrador de cuestionario de posicionamiento de marca', PRICE_SENSITIVITY: 'Borrador de cuestionario de sensibilidad al precio', SURVEY_PRETEST: 'Borrador de guía de pretest cognitivo', INTERVIEW_GUIDE: 'Borrador de guía de entrevista humana' },
    offerInstruction: 'Revise la siguiente oferta exactamente como se muestra.', messageInstruction: 'Revise el siguiente mensaje exactamente como se muestra.', claimInstruction: 'Revise la siguiente afirmación exactamente como se muestra.', uxInstruction: 'Revise el siguiente escenario de tarea y la descripción de experiencia.', featureInstruction: 'Revise el siguiente conjunto de funciones exactamente como se muestra.', brandInstruction: 'Revise las siguientes marcas y atributos exactamente como se muestran.', priceInstruction: 'Revise la siguiente oferta y los puntos de precio exactamente como se muestran.', surveyPretestInstruction: 'Revise cada pregunta de encuesta suministrada exactamente como se muestra.', interviewIntro: 'Apertura del moderador: confirme consentimiento, privacidad, estado de grabación, necesidades de accesibilidad y derecho a detenerse antes de preguntar sobre los temas.',
    messagePrimary: (intendedAction) => `¿Qué tan convincente es este mensaje para la acción prevista: ${intendedAction}?`, claimPrimary: () => '¿Qué tan creíble es esta afirmación tal como se presenta?', uxPrimary: (userGoal) => `¿Qué tan fácil o difícil espera que sea lograr este objetivo: ${userGoal}?`, featurePrimary: (selectionConstraint) => `Ordene estas funciones bajo esta restricción: ${selectionConstraint}.`, brandPrimary: (category) => `Para cada atributo suministrado, ¿qué marca de ${category} asocia más con ese atributo?`, pricePrimary: (purchaseHorizon) => `Para cada precio suministrado, ¿qué probabilidad habría de que comprara la oferta exacta ${purchaseHorizon.toLowerCase()}?`, surveyPretestPrimary: 'Para cada pregunta suministrada, ¿qué entendió que preguntaba y qué la hizo difícil de responder?', topicPrompt: (topic) => `Cuénteme sobre ${topic}.`,
    claimClarity: '¿Qué resulta poco claro, exagerado o necesita sustento?', uxFriction: '¿Qué haría que esta tarea fuera más fácil o más difícil?', featureReason: '¿Qué compensaciones influyeron más en su ordenamiento?', brandReason: '¿Qué asociaciones o experiencias guiaron sus elecciones?', priceReason: '¿Qué cambió entre los precios suministrados y qué influyó más en sus respuestas?', surveyPretestProbe: '¿Qué palabras, supuestos, escalas o periodos de recuerdo debería revisar el investigador?', interviewClose: '¿Hay algo más que el investigador debería entender antes de cerrar?', sensitiveAreas: (areas) => `Nota para el moderador: trate estas áreas sensibles con cuidado y permita omitir cualquiera de ellas: ${areas.join('; ')}.`,
    messageScale: ['Nada convincente', 'Poco convincente', 'Ni convincente ni poco convincente', 'Convincente', 'Muy convincente'], claimScale: ['Nada creíble', 'Poco creíble', 'Ni creíble ni increíble', 'Creíble', 'Muy creíble'], easeScale: ['Muy difícil', 'Difícil', 'Ni difícil ni fácil', 'Fácil', 'Muy fácil'],
  },
  pt: {
    methodTitles: { GENERAL_LIKERT: 'Rascunho de questionário para pesquisa com pessoas', CONCEPT_TEST: 'Rascunho de questionário de teste de conceito', PURCHASE_INTENT: 'Rascunho de questionário de intenção de compra', MESSAGE_TEST: 'Rascunho de questionário de teste de mensagem', CLAIMS_TEST: 'Rascunho de questionário de teste de afirmação', UX_EXPECTATION_TEST: 'Rascunho de questionário de expectativa de UX', FEATURE_PRIORITIZATION: 'Rascunho de exercício de priorização de recursos', BRAND_POSITIONING: 'Rascunho de questionário de posicionamento de marca', PRICE_SENSITIVITY: 'Rascunho de questionário de sensibilidade a preço', SURVEY_PRETEST: 'Rascunho de guia de pré-teste cognitivo', INTERVIEW_GUIDE: 'Rascunho de guia de entrevista humana' },
    offerInstruction: 'Analise a oferta a seguir exatamente como apresentada.', messageInstruction: 'Analise a mensagem a seguir exatamente como apresentada.', claimInstruction: 'Analise a afirmação a seguir exatamente como apresentada.', uxInstruction: 'Analise o cenário de tarefa e a descrição da experiência a seguir.', featureInstruction: 'Analise o conjunto de recursos a seguir exatamente como apresentado.', brandInstruction: 'Analise as marcas e os atributos a seguir exatamente como apresentados.', priceInstruction: 'Analise a oferta e os pontos de preço a seguir exatamente como apresentados.', surveyPretestInstruction: 'Analise cada pergunta de pesquisa fornecida exatamente como apresentada.', interviewIntro: 'Abertura do moderador: confirme consentimento, privacidade, status da gravação, necessidades de acessibilidade e direito de interromper antes de perguntar sobre os tópicos.',
    messagePrimary: (intendedAction) => `Quão convincente é esta mensagem para a ação pretendida: ${intendedAction}?`, claimPrimary: () => 'Quão crível é esta afirmação como apresentada?', uxPrimary: (userGoal) => `Quão fácil ou difícil você espera que seja cumprir este objetivo: ${userGoal}?`, featurePrimary: (selectionConstraint) => `Ordene estes recursos sob esta restrição: ${selectionConstraint}.`, brandPrimary: (category) => `Para cada atributo fornecido, qual marca em ${category} você mais associa a esse atributo?`, pricePrimary: (purchaseHorizon) => `Para cada preço fornecido, qual seria a probabilidade de você comprar a oferta exata ${purchaseHorizon.toLowerCase()}?`, surveyPretestPrimary: 'Para cada pergunta fornecida, o que você entendeu que ela perguntava e o que dificultou a resposta?', topicPrompt: (topic) => `Conte-me sobre ${topic}.`,
    claimClarity: 'O que está pouco claro, exagerado ou precisa de comprovação?', uxFriction: 'O que tornaria esta tarefa mais fácil ou mais difícil?', featureReason: 'Quais trocas mais influenciaram sua ordenação?', brandReason: 'Quais associações ou experiências orientaram suas escolhas?', priceReason: 'O que mudou entre os preços fornecidos e o que mais influenciou suas respostas?', surveyPretestProbe: 'Quais palavras, pressupostos, escalas ou períodos de lembrança o pesquisador deveria revisar?', interviewClose: 'Há algo mais que o pesquisador deveria entender antes de encerrar?', sensitiveAreas: (areas) => `Nota ao moderador: trate estas áreas sensíveis com cuidado e permita que a pessoa pule qualquer uma delas: ${areas.join('; ')}.`,
    messageScale: ['Nada convincente', 'Pouco convincente', 'Nem convincente nem pouco convincente', 'Convincente', 'Muito convincente'], claimScale: ['Nada crível', 'Pouco crível', 'Nem crível nem incrível', 'Crível', 'Muito crível'], easeScale: ['Muito difícil', 'Difícil', 'Nem difícil nem fácil', 'Fácil', 'Muito fácil'],
  },
  fr: {
    methodTitles: { GENERAL_LIKERT: 'Projet de questionnaire pour une étude auprès de personnes', CONCEPT_TEST: 'Projet de questionnaire de test de concept', PURCHASE_INTENT: 'Projet de questionnaire d’intention d’achat', MESSAGE_TEST: 'Projet de questionnaire de test de message', CLAIMS_TEST: 'Projet de questionnaire de test d’allégation', UX_EXPECTATION_TEST: 'Projet de questionnaire d’attente UX', FEATURE_PRIORITIZATION: 'Projet d’exercice de priorisation des fonctionnalités', BRAND_POSITIONING: 'Projet de questionnaire de positionnement de marque', PRICE_SENSITIVITY: 'Projet de questionnaire de sensibilité au prix', SURVEY_PRETEST: 'Projet de guide de prétest cognitif', INTERVIEW_GUIDE: 'Projet de guide d’entretien humain' },
    offerInstruction: 'Veuillez examiner l’offre suivante exactement telle qu’elle est présentée.', messageInstruction: 'Veuillez examiner le message suivant exactement tel qu’il est présenté.', claimInstruction: 'Veuillez examiner l’allégation suivante exactement telle qu’elle est présentée.', uxInstruction: 'Veuillez examiner le scénario de tâche et la description de l’expérience suivants.', featureInstruction: 'Veuillez examiner l’ensemble de fonctionnalités suivant exactement tel qu’il est présenté.', brandInstruction: 'Veuillez examiner les marques et attributs suivants exactement tels qu’ils sont présentés.', priceInstruction: 'Veuillez examiner l’offre et les prix suivants exactement tels qu’ils sont présentés.', surveyPretestInstruction: 'Veuillez examiner chaque question d’enquête fournie exactement telle qu’elle est présentée.', interviewIntro: 'Ouverture du modérateur : confirmer le consentement, la confidentialité, l’enregistrement, les besoins d’accessibilité et le droit d’arrêter avant les questions thématiques.',
    messagePrimary: (intendedAction) => `Dans quelle mesure ce message est-il convaincant pour l’action prévue : ${intendedAction} ?`, claimPrimary: () => 'Dans quelle mesure cette allégation est-elle crédible telle qu’elle est présentée ?', uxPrimary: (userGoal) => `Selon vous, dans quelle mesure serait-il facile ou difficile d’atteindre cet objectif : ${userGoal} ?`, featurePrimary: (selectionConstraint) => `Classez ces fonctionnalités selon cette contrainte : ${selectionConstraint}.`, brandPrimary: (category) => `Pour chaque attribut fourni, quelle marque de ${category} associez-vous le plus à cet attribut ?`, pricePrimary: (purchaseHorizon) => `Pour chaque prix fourni, quelle serait la probabilité que vous achetiez l’offre exacte ${purchaseHorizon.toLowerCase()} ?`, surveyPretestPrimary: 'Pour chaque question fournie, qu’avez-vous compris qu’elle demandait et qu’est-ce qui la rendait difficile à répondre ?', topicPrompt: (topic) => `Parlez-moi de ${topic}.`,
    claimClarity: 'Qu’est-ce qui est peu clair, exagéré ou nécessite une preuve ?', uxFriction: 'Qu’est-ce qui rendrait cette tâche plus facile ou plus difficile ?', featureReason: 'Quels arbitrages ont le plus influencé votre classement ?', brandReason: 'Quelles associations ou expériences ont guidé vos choix ?', priceReason: 'Qu’est-ce qui a changé entre les prix fournis et qu’est-ce qui a le plus influencé vos réponses ?', surveyPretestProbe: 'Quels mots, hypothèses, échelles ou périodes de rappel le chercheur devrait-il revoir ?', interviewClose: 'Y a-t-il autre chose que le chercheur devrait comprendre avant de conclure ?', sensitiveAreas: (areas) => `Note au modérateur : traiter ces sujets sensibles avec prudence et permettre à la personne d’en ignorer un : ${areas.join('; ')}.`,
    messageScale: ['Pas du tout convaincant', 'Peu convaincant', 'Ni convaincant ni peu convaincant', 'Convaincant', 'Très convaincant'], claimScale: ['Pas du tout crédible', 'Peu crédible', 'Ni crédible ni non crédible', 'Crédible', 'Très crédible'], easeScale: ['Très difficile', 'Difficile', 'Ni difficile ni facile', 'Facile', 'Très facile'],
  },
  de: {
    methodTitles: { GENERAL_LIKERT: 'Fragebogenentwurf für Forschung mit Menschen', CONCEPT_TEST: 'Entwurf eines Konzepttest-Fragebogens', PURCHASE_INTENT: 'Entwurf eines Kaufabsicht-Fragebogens', MESSAGE_TEST: 'Entwurf eines Botschaftstest-Fragebogens', CLAIMS_TEST: 'Entwurf eines Claim-Test-Fragebogens', UX_EXPECTATION_TEST: 'Entwurf eines UX-Erwartungsfragebogens', FEATURE_PRIORITIZATION: 'Entwurf einer Feature-Priorisierungsübung', BRAND_POSITIONING: 'Entwurf eines Markenpositionierungs-Fragebogens', PRICE_SENSITIVITY: 'Entwurf eines Preissensitivitäts-Fragebogens', SURVEY_PRETEST: 'Entwurf eines kognitiven Pretest-Leitfadens', INTERVIEW_GUIDE: 'Entwurf eines Leitfadens für Humaninterviews' },
    offerInstruction: 'Bitte prüfen Sie das folgende Angebot genau wie gezeigt.', messageInstruction: 'Bitte prüfen Sie die folgende Botschaft genau wie gezeigt.', claimInstruction: 'Bitte prüfen Sie den folgenden Claim genau wie gezeigt.', uxInstruction: 'Bitte prüfen Sie das folgende Aufgabenszenario und die Erlebnisbeschreibung.', featureInstruction: 'Bitte prüfen Sie die folgende Feature-Auswahl genau wie gezeigt.', brandInstruction: 'Bitte prüfen Sie die folgenden Marken und Attribute genau wie gezeigt.', priceInstruction: 'Bitte prüfen Sie das folgende Angebot und die Preispunkte genau wie gezeigt.', surveyPretestInstruction: 'Bitte prüfen Sie jede bereitgestellte Umfragefrage genau wie gezeigt.', interviewIntro: 'Moderationsbeginn: Einwilligung, Datenschutz, Aufzeichnungsstatus, Barrierefreiheitsbedarf und das Recht zum Abbruch bestätigen, bevor Themenfragen gestellt werden.',
    messagePrimary: (intendedAction) => `Wie überzeugend ist diese Botschaft für die beabsichtigte Handlung: ${intendedAction}?`, claimPrimary: () => 'Wie glaubwürdig ist dieser Claim in der vorgelegten Form?', uxPrimary: (userGoal) => `Wie leicht oder schwierig wäre es Ihrer Erwartung nach, dieses Ziel zu erreichen: ${userGoal}?`, featurePrimary: (selectionConstraint) => `Ordnen Sie diese Features unter dieser Vorgabe: ${selectionConstraint}.`, brandPrimary: (category) => `Welche Marke in ${category} verbinden Sie bei jedem bereitgestellten Attribut am stärksten mit diesem Attribut?`, pricePrimary: (purchaseHorizon) => `Wie wahrscheinlich wäre es bei jedem bereitgestellten Preis, dass Sie das genaue Angebot ${purchaseHorizon.toLowerCase()} kaufen?`, surveyPretestPrimary: 'Was sollte jede bereitgestellte Frage aus Ihrer Sicht erfragen, und wodurch war sie schwer zu beantworten?', topicPrompt: (topic) => `Erzählen Sie mir von ${topic}.`,
    claimClarity: 'Was ist unklar, überzogen oder belegbedürftig?', uxFriction: 'Was würde diese Aufgabe leichter oder schwieriger machen?', featureReason: 'Welche Abwägungen haben Ihre Rangfolge am stärksten beeinflusst?', brandReason: 'Welche Assoziationen oder Erfahrungen haben Ihre Auswahl beeinflusst?', priceReason: 'Was änderte sich zwischen den bereitgestellten Preisen, und was beeinflusste Ihre Antworten am stärksten?', surveyPretestProbe: 'Welche Wörter, Annahmen, Skalen oder Erinnerungszeiträume sollte die Forschungsperson überarbeiten?', interviewClose: 'Gibt es noch etwas, das die Forschungsperson vor dem Abschluss verstehen sollte?', sensitiveAreas: (areas) => `Hinweis für die Moderation: Diese sensiblen Bereiche vorsichtig behandeln und das Überspringen erlauben: ${areas.join('; ')}.`,
    messageScale: ['Überhaupt nicht überzeugend', 'Wenig überzeugend', 'Weder überzeugend noch nicht überzeugend', 'Überzeugend', 'Sehr überzeugend'], claimScale: ['Überhaupt nicht glaubwürdig', 'Wenig glaubwürdig', 'Weder glaubwürdig noch unglaubwürdig', 'Glaubwürdig', 'Sehr glaubwürdig'], easeScale: ['Sehr schwierig', 'Schwierig', 'Weder schwierig noch leicht', 'Leicht', 'Sehr leicht'],
  },
  zh: {
    methodTitles: { GENERAL_LIKERT: '真人研究问卷草案', CONCEPT_TEST: '真人概念测试问卷草案', PURCHASE_INTENT: '真人购买意向问卷草案', MESSAGE_TEST: '真人信息测试问卷草案', CLAIMS_TEST: '真人声明测试问卷草案', UX_EXPECTATION_TEST: '真人用户体验预期问卷草案', FEATURE_PRIORITIZATION: '真人功能优先级练习草案', BRAND_POSITIONING: '真人品牌定位问卷草案', PRICE_SENSITIVITY: '真人价格敏感度问卷草案', SURVEY_PRETEST: '认知预测试指南草案', INTERVIEW_GUIDE: '真人访谈指南草案' },
    offerInstruction: '请严格按照所示内容阅读以下方案。', messageInstruction: '请严格按照所示内容阅读以下信息。', claimInstruction: '请严格按照所示内容阅读以下声明。', uxInstruction: '请阅读以下任务场景和体验描述。', featureInstruction: '请严格按照所示内容阅读以下功能集合。', brandInstruction: '请严格按照所示内容阅读以下品牌和属性。', priceInstruction: '请严格按照所示内容阅读以下方案和价格点。', surveyPretestInstruction: '请严格按照所示内容阅读每一道已提供的问卷题目。', interviewIntro: '主持人开场：在提出主题问题前，确认同意、隐私预期、录音状态、无障碍需求以及随时停止的权利。',
    messagePrimary: (intendedAction) => `对于预期行动“${intendedAction}”，这条信息有多有说服力？`, claimPrimary: () => '这条声明按所示内容呈现时有多可信？', uxPrimary: (userGoal) => `您预计完成这个目标会有多容易或困难：${userGoal}？`, featurePrimary: (selectionConstraint) => `请在以下约束下排列这些功能：${selectionConstraint}。`, brandPrimary: (category) => `对于每个已提供属性，您最会把${category}中的哪个品牌与该属性联系起来？`, pricePrimary: (purchaseHorizon) => `对于每个已提供价格，您在${purchaseHorizon}购买这一确切方案的可能性有多大？`, surveyPretestPrimary: '对于每一道已提供题目，您认为它在询问什么？哪些地方让它难以回答？', topicPrompt: (topic) => `请谈谈${topic}。`,
    claimClarity: '哪些内容不清楚、表述过强或需要证明？', uxFriction: '什么会让这项任务更容易或更困难？', featureReason: '哪些取舍对您的排序影响最大？', brandReason: '哪些联想或经历影响了您的选择？', priceReason: '这些价格之间有什么变化？什么最影响您的回答？', surveyPretestProbe: '研究者应修改哪些词语、假设、量表或回忆周期？', interviewClose: '结束前，还有什么是研究者应该了解的吗？', sensitiveAreas: (areas) => `主持人备注：请谨慎处理这些敏感领域，并允许参与者跳过：${areas.join('；')}。`,
    messageScale: ['完全没有说服力', '略有说服力', '既非有说服力也非没有说服力', '有说服力', '非常有说服力'], claimScale: ['完全不可信', '略可信', '既非可信也非不可信', '可信', '非常可信'], easeScale: ['非常困难', '困难', '不难也不容易', '容易', '非常容易'],
  },
  ja: {
    methodTitles: { GENERAL_LIKERT: '実参加者調査用アンケート草案', CONCEPT_TEST: '実参加者向けコンセプトテスト質問票草案', PURCHASE_INTENT: '実参加者向け購入意向質問票草案', MESSAGE_TEST: '実参加者向けメッセージテスト質問票草案', CLAIMS_TEST: '実参加者向け訴求テスト質問票草案', UX_EXPECTATION_TEST: '実参加者向けUX期待質問票草案', FEATURE_PRIORITIZATION: '実参加者向け機能優先度演習草案', BRAND_POSITIONING: '実参加者向けブランドポジショニング質問票草案', PRICE_SENSITIVITY: '実参加者向け価格感度質問票草案', SURVEY_PRETEST: '認知的プリテストガイド草案', INTERVIEW_GUIDE: '実参加者インタビューガイド草案' },
    offerInstruction: '次の提案を表示どおりに確認してください。', messageInstruction: '次のメッセージを表示どおりに確認してください。', claimInstruction: '次の主張を表示どおりに確認してください。', uxInstruction: '次のタスクシナリオと体験説明を確認してください。', featureInstruction: '次の機能セットを表示どおりに確認してください。', brandInstruction: '次のブランドと属性を表示どおりに確認してください。', priceInstruction: '次の提案と価格点を表示どおりに確認してください。', surveyPretestInstruction: '提示された各調査質問を表示どおりに確認してください。', interviewIntro: 'モデレーター冒頭：テーマ質問に入る前に、同意、プライバシー、録音状況、アクセシビリティ上の配慮、いつでも中止できる権利を確認してください。',
    messagePrimary: (intendedAction) => `意図された行動「${intendedAction}」に対して、このメッセージはどの程度説得力がありますか？`, claimPrimary: () => 'この主張は提示された形でどの程度信頼できますか？', uxPrimary: (userGoal) => `この目標を達成することは、どの程度簡単または難しいと思いますか：${userGoal}？`, featurePrimary: (selectionConstraint) => `この制約に従って、これらの機能を順位付けしてください：${selectionConstraint}。`, brandPrimary: (category) => `提示された各属性について、${category}のどのブランドをその属性と最も強く結び付けますか？`, pricePrimary: (purchaseHorizon) => `提示された各価格について、この正確な提案を${purchaseHorizon}に購入する可能性はどの程度ありますか？`, surveyPretestPrimary: '提示された各質問について、何を尋ねていると理解しましたか。また、何が回答を難しくしましたか？', topicPrompt: (topic) => `${topic}について教えてください。`,
    claimClarity: '不明確な点、言い過ぎに感じる点、根拠が必要な点は何ですか？', uxFriction: 'このタスクをより簡単または難しくするものは何ですか？', featureReason: '順位付けに最も影響したトレードオフは何ですか？', brandReason: '選択の背景にある連想や経験は何ですか？', priceReason: '提示された価格の間で何が変わり、回答に最も影響しましたか？', surveyPretestProbe: '研究者はどの語句、前提、尺度、想起期間を見直すべきですか？', interviewClose: '終了前に、研究者が理解しておくべきことは他にありますか？', sensitiveAreas: (areas) => `モデレーター注記：次の慎重な扱いが必要な領域は、参加者が回答を省略できるようにしてください：${areas.join('、')}。`,
    messageScale: ['まったく説得力がない', 'やや説得力が低い', 'どちらともいえない', '説得力がある', '非常に説得力がある'], claimScale: ['まったく信頼できない', 'あまり信頼できない', 'どちらともいえない', '信頼できる', '非常に信頼できる'], easeScale: ['非常に難しい', '難しい', 'どちらともいえない', '簡単', '非常に簡単'],
  },
  ko: {
    methodTitles: { GENERAL_LIKERT: '실제 참여자 연구 설문 초안', CONCEPT_TEST: '실제 참여자 콘셉트 테스트 설문 초안', PURCHASE_INTENT: '실제 참여자 구매 의향 설문 초안', MESSAGE_TEST: '실제 참여자 메시지 테스트 설문 초안', CLAIMS_TEST: '실제 참여자 주장 테스트 설문 초안', UX_EXPECTATION_TEST: '실제 참여자 UX 기대 설문 초안', FEATURE_PRIORITIZATION: '실제 참여자 기능 우선순위 연습 초안', BRAND_POSITIONING: '실제 참여자 브랜드 포지셔닝 설문 초안', PRICE_SENSITIVITY: '실제 참여자 가격 민감도 설문 초안', SURVEY_PRETEST: '인지 사전검사 가이드 초안', INTERVIEW_GUIDE: '실제 참여자 인터뷰 가이드 초안' },
    offerInstruction: '다음 제안을 표시된 그대로 검토해 주세요.', messageInstruction: '다음 메시지를 표시된 그대로 검토해 주세요.', claimInstruction: '다음 주장을 표시된 그대로 검토해 주세요.', uxInstruction: '다음 과업 시나리오와 경험 설명을 검토해 주세요.', featureInstruction: '다음 기능 묶음을 표시된 그대로 검토해 주세요.', brandInstruction: '다음 브랜드와 속성을 표시된 그대로 검토해 주세요.', priceInstruction: '다음 제안과 가격점을 표시된 그대로 검토해 주세요.', surveyPretestInstruction: '제공된 각 설문 문항을 표시된 그대로 검토해 주세요.', interviewIntro: '진행자 시작 안내: 주제 질문 전에 동의, 개인정보 기대, 녹음 여부, 접근성 필요, 언제든 중단할 권리를 확인하세요.',
    messagePrimary: (intendedAction) => `의도한 행동 “${intendedAction}”에 대해 이 메시지는 얼마나 설득력 있습니까?`, claimPrimary: () => '이 주장은 제시된 그대로 얼마나 믿을 만합니까?', uxPrimary: (userGoal) => `이 목표를 달성하는 것이 얼마나 쉽거나 어렵다고 예상하십니까: ${userGoal}?`, featurePrimary: (selectionConstraint) => `다음 제약에 따라 이 기능들의 순위를 매겨 주세요: ${selectionConstraint}.`, brandPrimary: (category) => `제공된 각 속성에 대해 ${category}에서 어떤 브랜드가 그 속성과 가장 잘 연결됩니까?`, pricePrimary: (purchaseHorizon) => `제공된 각 가격에서 이 정확한 제안을 ${purchaseHorizon}에 구매할 가능성은 어느 정도입니까?`, surveyPretestPrimary: '제공된 각 문항이 무엇을 묻는다고 이해했으며, 무엇이 답변을 어렵게 했습니까?', topicPrompt: (topic) => `${topic}에 대해 말씀해 주세요.`,
    claimClarity: '무엇이 불분명하거나 과장되었거나 근거가 더 필요합니까?', uxFriction: '무엇이 이 과업을 더 쉽게 또는 어렵게 만들겠습니까?', featureReason: '순위에 가장 큰 영향을 준 절충점은 무엇입니까?', brandReason: '선택에 영향을 준 연상이나 경험은 무엇입니까?', priceReason: '제공된 가격들 사이에서 무엇이 달라졌고, 무엇이 답변에 가장 영향을 주었습니까?', surveyPretestProbe: '연구자가 어떤 단어, 가정, 척도 또는 회상 기간을 수정해야 합니까?', interviewClose: '마무리하기 전에 연구자가 더 이해해야 할 것이 있습니까?', sensitiveAreas: (areas) => `진행자 메모: 다음 민감 영역은 신중히 다루고 참여자가 건너뛸 수 있게 하세요: ${areas.join('; ')}.`,
    messageScale: ['전혀 설득력 없음', '약간 설득력 있음', '설득력도 비설득력도 아님', '설득력 있음', '매우 설득력 있음'], claimScale: ['전혀 믿을 수 없음', '약간 믿을 수 있음', '믿을 수도 믿기 어려울 수도 있음', '믿을 수 있음', '매우 믿을 수 있음'], easeScale: ['매우 어려움', '어려움', '어렵지도 쉽지도 않음', '쉬움', '매우 쉬움'],
  },
  ar: {
    methodTitles: { GENERAL_LIKERT: 'مسودة استبيان لبحث مع مشاركين حقيقيين', CONCEPT_TEST: 'مسودة استبيان لاختبار مفهوم مع مشاركين حقيقيين', PURCHASE_INTENT: 'مسودة استبيان لنية الشراء مع مشاركين حقيقيين', MESSAGE_TEST: 'مسودة استبيان لاختبار رسالة مع مشاركين حقيقيين', CLAIMS_TEST: 'مسودة استبيان لاختبار ادعاء مع مشاركين حقيقيين', UX_EXPECTATION_TEST: 'مسودة استبيان لتوقع تجربة المستخدم', FEATURE_PRIORITIZATION: 'مسودة تمرين لتحديد أولوية الميزات', BRAND_POSITIONING: 'مسودة استبيان لتموضع العلامة التجارية', PRICE_SENSITIVITY: 'مسودة استبيان لحساسية السعر', SURVEY_PRETEST: 'مسودة دليل اختبار معرفي أولي', INTERVIEW_GUIDE: 'مسودة دليل مقابلة بشرية' },
    offerInstruction: 'يرجى مراجعة العرض التالي تماماً كما هو معروض.', messageInstruction: 'يرجى مراجعة الرسالة التالية تماماً كما هي معروضة.', claimInstruction: 'يرجى مراجعة الادعاء التالي تماماً كما هو معروض.', uxInstruction: 'يرجى مراجعة سيناريو المهمة ووصف التجربة التاليين.', featureInstruction: 'يرجى مراجعة مجموعة الميزات التالية تماماً كما هي معروضة.', brandInstruction: 'يرجى مراجعة العلامات والسمات التالية تماماً كما هي معروضة.', priceInstruction: 'يرجى مراجعة العرض ونقاط السعر التالية تماماً كما هي معروضة.', surveyPretestInstruction: 'يرجى مراجعة كل سؤال استطلاع مقدم تماماً كما هو معروض.', interviewIntro: 'افتتاحية الميسّر: أكّد الموافقة، وتوقعات الخصوصية، وحالة التسجيل، واحتياجات الوصول، والحق في التوقف قبل طرح أسئلة الموضوعات.',
    messagePrimary: (intendedAction) => `ما مدى إقناع هذه الرسالة للفعل المقصود: ${intendedAction}؟`, claimPrimary: () => 'ما مدى قابلية تصديق هذا الادعاء كما عُرض؟', uxPrimary: (userGoal) => `إلى أي مدى تتوقع أن يكون تحقيق هذا الهدف سهلاً أو صعباً: ${userGoal}؟`, featurePrimary: (selectionConstraint) => `رتّب هذه الميزات وفق هذا القيد: ${selectionConstraint}.`, brandPrimary: (category) => `لكل سمة مقدمة، أي علامة في ${category} تربطها أكثر بهذه السمة؟`, pricePrimary: (purchaseHorizon) => `لكل سعر مقدم، ما مدى احتمال شرائك العرض المحدد ${purchaseHorizon}؟`, surveyPretestPrimary: 'لكل سؤال مقدم، ماذا فهمت أنه يسأل، وما الذي جعل الإجابة صعبة؟', topicPrompt: (topic) => `حدثني عن ${topic}.`,
    claimClarity: 'ما غير الواضح أو المبالغ فيه أو الذي يحتاج إلى إثبات؟', uxFriction: 'ما الذي سيجعل هذه المهمة أسهل أو أصعب؟', featureReason: 'ما المفاضلات التي أثرت أكثر في ترتيبك؟', brandReason: 'ما الروابط أو الخبرات التي قادت اختياراتك؟', priceReason: 'ما الذي تغيّر بين الأسعار المقدمة، وما الأكثر تأثيراً في إجاباتك؟', surveyPretestProbe: 'ما الكلمات أو الافتراضات أو المقاييس أو فترات التذكر التي ينبغي للباحث مراجعتها؟', interviewClose: 'هل هناك شيء آخر ينبغي للباحث فهمه قبل الإغلاق؟', sensitiveAreas: (areas) => `ملاحظة للميسّر: تعامل مع هذه المجالات الحساسة بعناية واسمح للمشارك بتجاوز أي منها: ${areas.join('؛ ')}.`,
    messageScale: ['غير مقنعة إطلاقاً', 'مقنعة قليلاً', 'ليست مقنعة ولا غير مقنعة', 'مقنعة', 'مقنعة جداً'], claimScale: ['غير قابلة للتصديق إطلاقاً', 'قابلة للتصديق قليلاً', 'ليست قابلة ولا غير قابلة للتصديق', 'قابلة للتصديق', 'قابلة للتصديق جداً'], easeScale: ['صعبة جداً', 'صعبة', 'ليست صعبة ولا سهلة', 'سهلة', 'سهلة جداً'],
  },
  hi: {
    methodTitles: { GENERAL_LIKERT: 'वास्तविक प्रतिभागी शोध के लिए प्रश्नावली का मसौदा', CONCEPT_TEST: 'वास्तविक प्रतिभागी कॉन्सेप्ट टेस्ट प्रश्नावली मसौदा', PURCHASE_INTENT: 'वास्तविक प्रतिभागी खरीद इरादा प्रश्नावली मसौदा', MESSAGE_TEST: 'वास्तविक प्रतिभागी संदेश परीक्षण प्रश्नावली मसौदा', CLAIMS_TEST: 'वास्तविक प्रतिभागी दावे परीक्षण प्रश्नावली मसौदा', UX_EXPECTATION_TEST: 'वास्तविक प्रतिभागी UX अपेक्षा प्रश्नावली मसौदा', FEATURE_PRIORITIZATION: 'वास्तविक प्रतिभागी फीचर प्राथमिकता अभ्यास मसौदा', BRAND_POSITIONING: 'वास्तविक प्रतिभागी ब्रांड पोजिशनिंग प्रश्नावली मसौदा', PRICE_SENSITIVITY: 'वास्तविक प्रतिभागी मूल्य संवेदनशीलता प्रश्नावली मसौदा', SURVEY_PRETEST: 'संज्ञानात्मक प्रीटेस्ट गाइड मसौदा', INTERVIEW_GUIDE: 'वास्तविक प्रतिभागी साक्षात्कार गाइड मसौदा' },
    offerInstruction: 'कृपया नीचे दिए प्रस्ताव को ठीक उसी रूप में देखें जैसा दिखाया गया है।', messageInstruction: 'कृपया नीचे दिए संदेश को ठीक उसी रूप में देखें जैसा दिखाया गया है।', claimInstruction: 'कृपया नीचे दिए दावे को ठीक उसी रूप में देखें जैसा दिखाया गया है।', uxInstruction: 'कृपया नीचे दिए कार्य परिदृश्य और अनुभव विवरण की समीक्षा करें।', featureInstruction: 'कृपया नीचे दिए फीचर सेट को ठीक उसी रूप में देखें जैसा दिखाया गया है।', brandInstruction: 'कृपया नीचे दिए ब्रांड और गुणों को ठीक उसी रूप में देखें जैसा दिखाया गया है।', priceInstruction: 'कृपया नीचे दिए प्रस्ताव और मूल्य बिंदुओं को ठीक उसी रूप में देखें जैसा दिखाया गया है।', surveyPretestInstruction: 'कृपया दी गई हर सर्वे प्रश्न को ठीक उसी रूप में देखें जैसा दिखाया गया है।', interviewIntro: 'मॉडरेटर शुरुआत: विषय प्रश्नों से पहले सहमति, गोपनीयता अपेक्षाएँ, रिकॉर्डिंग स्थिति, पहुँच आवश्यकताएँ, और रोकने के अधिकार की पुष्टि करें।',
    messagePrimary: (intendedAction) => `इच्छित कार्रवाई “${intendedAction}” के लिए यह संदेश कितना प्रभावी है?`, claimPrimary: () => 'यह दावा प्रस्तुत रूप में कितना विश्वसनीय है?', uxPrimary: (userGoal) => `आपको यह लक्ष्य पूरा करना कितना आसान या कठिन लगता है: ${userGoal}?`, featurePrimary: (selectionConstraint) => `इन फीचरों को इस बाध्यता के अंतर्गत क्रम दें: ${selectionConstraint}.`, brandPrimary: (category) => `दिए गए प्रत्येक गुण के लिए, ${category} में किस ब्रांड को आप उस गुण से सबसे अधिक जोड़ते हैं?`, pricePrimary: (purchaseHorizon) => `दिए गए प्रत्येक मूल्य पर, आपके इस सटीक प्रस्ताव को ${purchaseHorizon} खरीदने की कितनी संभावना है?`, surveyPretestPrimary: 'दी गई हर प्रश्न के लिए, आपने समझा कि वह क्या पूछ रही थी और किस बात ने उत्तर देना कठिन बनाया?', topicPrompt: (topic) => `${topic} के बारे में बताइए।`,
    claimClarity: 'क्या अस्पष्ट, बढ़ा-चढ़ाकर कहा गया, या प्रमाण की आवश्यकता वाला है?', uxFriction: 'क्या इस कार्य को आसान या कठिन बनाएगा?', featureReason: 'आपकी रैंकिंग को किन समझौतों ने सबसे अधिक प्रभावित किया?', brandReason: 'आपके चुनावों को किन संबंधों या अनुभवों ने प्रभावित किया?', priceReason: 'दिए गए मूल्यों के बीच क्या बदला और आपकी प्रतिक्रियाओं को किसने सबसे अधिक प्रभावित किया?', surveyPretestProbe: 'शोधकर्ता को किन शब्दों, मान्यताओं, पैमानों या स्मरण अवधियों को संशोधित करना चाहिए?', interviewClose: 'समाप्त करने से पहले क्या शोधकर्ता को कुछ और समझना चाहिए?', sensitiveAreas: (areas) => `मॉडरेटर नोट: इन संवेदनशील क्षेत्रों को सावधानी से लें और प्रतिभागी को इनमें से कोई भी छोड़ने दें: ${areas.join('; ')}.`,
    messageScale: ['बिल्कुल प्रभावी नहीं', 'थोड़ा प्रभावी', 'न प्रभावी न अप्रभावी', 'प्रभावी', 'बहुत प्रभावी'], claimScale: ['बिल्कुल विश्वसनीय नहीं', 'थोड़ा विश्वसनीय', 'न विश्वसनीय न अविश्वसनीय', 'विश्वसनीय', 'बहुत विश्वसनीय'], easeScale: ['बहुत कठिन', 'कठिन', 'न कठिन न आसान', 'आसान', 'बहुत आसान'],
  },
};

const SPECIALIZED_METHODS = new Set([
  'CONCEPT_TEST', 'PURCHASE_INTENT', 'MESSAGE_TEST', 'CLAIMS_TEST', 'UX_EXPECTATION_TEST', 'FEATURE_PRIORITIZATION', 'BRAND_POSITIONING', 'PRICE_SENSITIVITY', 'SURVEY_PRETEST', 'INTERVIEW_GUIDE',
]);
const NOMINAL_PROPORTION_METHODS = new Set([
  'CONCEPT_TEST', 'PURCHASE_INTENT', 'MESSAGE_TEST', 'CLAIMS_TEST', 'UX_EXPECTATION_TEST',
]);
const COMPLEX_QUANTITATIVE_METHODS = new Set([
  'FEATURE_PRIORITIZATION', 'BRAND_POSITIONING', 'PRICE_SENSITIVITY',
]);
const QUALITATIVE_METHODS = new Set(['SURVEY_PRETEST', 'INTERVIEW_GUIDE']);
const DRAFT_DISCLOSURE = 'This is an unvalidated field draft generated from the study brief and method template. Review all respondent-facing language and stimuli, obtain any required ethics and privacy approvals, and cognitively pretest it before launch.';
const RELEASED_INSTRUMENT_TEMPLATE_LOCALES = Object.freeze({
  'en-US': 'en',
  'es-ES': 'es',
  'pt-BR': 'pt',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'zh-CN': 'zh',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  'ar-SA': 'ar',
  'hi-IN': 'hi',
});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const reportLocaleFor = (input) => input.localization?.report?.locale || input.outputLocale;
const instrumentLocaleFor = (input) => input.localization?.instrument?.locale || input.outputLocale;
const templateLanguageFor = (locale) => RELEASED_INSTRUMENT_TEMPLATE_LOCALES[locale] || null;
const templateLocaleSupported = (locale) => {
  const language = templateLanguageFor(locale);
  return Boolean(language && COPY[language] && PRIMARY_COPY[language] && METHOD_COPY[language]);
};
const copyFor = (locale) => {
  const language = templateLanguageFor(locale);
  if (!templateLocaleSupported(locale)) return null;
  return { ...COPY[language], ...PRIMARY_COPY[language], ...METHOD_COPY[language] };
};
const optionRows = (labels) => labels.map((label, index) => ({ code: String(index + 1), label, order: index + 1 }));
const itemOptionRows = (items, labelKey = 'text') => items.map((item, index) => ({ code: item.id, label: item[labelKey], order: index + 1 }));
const itemRows = (items, labelKey = 'text') => items.map((item) => ({ itemId: item.id, text: item[labelKey] }));
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasIdText = (value, labelKey = 'text') => value && hasText(value.id) && hasText(value[labelKey]);
const priceLabel = (amount, currency, unit) => `${amount} ${currency} ${unit}`;

function respondentFacingUserText(input, frame = {}) {
  const config = input.methodConfig || {};
  switch (input.researchMethod) {
    case 'GENERAL_LIKERT': return frame.neutralQuestion ? [] : [input.prompt];
    case 'CONCEPT_TEST': return [config.concept?.text];
    case 'PURCHASE_INTENT': return [config.offer?.text, config.category, config.price?.unit, config.channel, config.purchaseHorizon, config.referenceAlternative];
    case 'MESSAGE_TEST': return [config.message?.text, config.intendedAction, config.exposureContext];
    case 'CLAIMS_TEST': return [config.claim?.text];
    case 'UX_EXPECTATION_TEST': return [config.taskScenario?.text, config.userGoal, config.experienceDescription, config.context, config.device];
    case 'FEATURE_PRIORITIZATION': return [...(config.features || []).map((feature) => feature?.text), config.selectionConstraint];
    case 'BRAND_POSITIONING': return [config.focalBrand?.label, ...(config.comparatorBrands || []).map((brand) => brand?.label), config.category, ...(config.attributes || []).map((attribute) => attribute?.label)];
    case 'PRICE_SENSITIVITY': return [config.offer?.text, config.category, config.unit, config.channel, config.purchaseHorizon, config.referenceAlternative];
    case 'SURVEY_PRETEST': return (config.surveyQuestions || []).map((surveyQuestion) => surveyQuestion?.text);
    case 'INTERVIEW_GUIDE': return [...(config.topics || []).map((topic) => topic?.label), ...(config.sensitiveAreas || [])];
    default: return [];
  }
}

function respondentFacingUserCopyIssues(input, frame) {
  const instrumentLocale = instrumentLocaleFor(input);
  if (!templateLocaleSupported(instrumentLocale)) return [];
  return respondentFacingUserText(input, frame)
    .filter(hasText)
    .some((value) => {
      const report = languageScriptReport(value, instrumentLocale);
      return report.checked && !report.pass;
    })
    ? ['RESPONDENT_FACING_USER_COPY_LOCALE_SCRIPT_MISMATCH']
    : [];
}

function methodConfigIsUsable(method, config) {
  if (method === 'GENERAL_LIKERT') return true;
  if (!SPECIALIZED_METHODS.has(method) || !config || config.method !== method) return false;
  switch (method) {
    case 'CONCEPT_TEST': return hasIdText(config.concept);
    case 'PURCHASE_INTENT': return hasIdText(config.offer) && hasText(config.category) && Number.isFinite(config.price?.amount) && hasText(config.price?.currency) && hasText(config.price?.unit) && hasText(config.channel) && hasText(config.purchaseHorizon) && hasText(config.referenceAlternative);
    case 'MESSAGE_TEST': return hasIdText(config.message) && hasText(config.intendedAction);
    case 'CLAIMS_TEST': return hasIdText(config.claim) && hasText(config.claimStatus);
    case 'UX_EXPECTATION_TEST': return hasIdText(config.taskScenario) && hasText(config.userGoal) && hasText(config.experienceDescription);
    case 'FEATURE_PRIORITIZATION': return Array.isArray(config.features) && config.features.length >= 3 && config.features.every((feature) => hasIdText(feature)) && hasText(config.decisionContext) && hasText(config.selectionConstraint);
    case 'BRAND_POSITIONING': return hasIdText(config.focalBrand, 'label') && Array.isArray(config.comparatorBrands) && config.comparatorBrands.length >= 2 && config.comparatorBrands.every((brand) => hasIdText(brand, 'label')) && hasText(config.category) && Array.isArray(config.attributes) && config.attributes.length >= 3 && config.attributes.every((attribute) => hasIdText(attribute, 'label'));
    case 'PRICE_SENSITIVITY': return hasIdText(config.offer) && hasText(config.category) && hasText(config.currency) && hasText(config.unit) && hasText(config.channel) && hasText(config.purchaseHorizon) && hasText(config.referenceAlternative) && Array.isArray(config.pricePoints) && config.pricePoints.length >= 3 && config.pricePoints.every((point, index) => hasText(point.id) && Number.isFinite(point.amount) && point.amount > 0 && (index === 0 || point.amount > config.pricePoints[index - 1].amount));
    case 'SURVEY_PRETEST': return hasText(config.studyObjective) && hasText(config.targetPopulation) && Array.isArray(config.surveyQuestions) && config.surveyQuestions.length >= 1 && config.surveyQuestions.every((surveyQuestion) => hasIdText(surveyQuestion));
    case 'INTERVIEW_GUIDE': return hasText(config.researchObjective) && hasText(config.participantContext) && Array.isArray(config.topics) && config.topics.length >= 2 && config.topics.every((topic) => hasIdText(topic, 'label'));
    default: return false;
  }
}

function handoffBlockingIssues(input, frame) {
  const issues = [];
  const reportLocale = reportLocaleFor(input);
  const instrumentLocale = instrumentLocaleFor(input);
  if (!templateLocaleSupported(instrumentLocale)) issues.push('UNSUPPORTED_HANDOFF_LOCALE_REQUIRES_HUMAN_TRANSLATION');
  if (reportLocale !== instrumentLocale) issues.push('REPORT_INSTRUMENT_LOCALE_MISMATCH_REQUIRES_TRANSLATION_REVIEW');
  if (input.researchMethod === 'GENERAL_LIKERT') {
    issues.push('GENERAL_LIKERT_REQUIRES_SPECIALIZED_METHOD');
    const primaryText = frame.neutralQuestion || input.prompt;
    const script = languageScriptReport(primaryText, instrumentLocale);
    if (script.checked && !script.pass) issues.push('PRIMARY_ITEM_OUTPUT_LOCALE_SCRIPT_MISMATCH');
  } else if (!methodConfigIsUsable(input.researchMethod, input.methodConfig)) {
    issues.push(SPECIALIZED_METHODS.has(input.researchMethod) ? 'METHOD_CONFIG_REQUIRED_FOR_HANDOFF' : 'METHOD_SPECIFIC_HANDOFF_TEMPLATE_MISSING');
  } else {
    issues.push(...respondentFacingUserCopyIssues(input, frame));
  }
  return issues;
}

function question({ questionId, order, type, text, options = [], analysisRole, provenanceClass = 'METHOD_TEMPLATE', stimulusId = null, required = true, reviewFlags = [], sourceIds = [], items = [], validation = null, instruction = null }) {
  const selectionCount = ['RANK_ORDER', 'MATRIX_SINGLE_SELECT'].includes(type) ? (items.length || options.length || null) : null;
  const base = { questionId, sectionId: type === 'STIMULUS' ? 'EXPOSURE' : questionId.startsWith('S') ? 'SCREENING' : 'MAIN', order, type, text, instruction, isRequired: required, stimulusId, options, displayConditions: [], validation: validation || { minimumSelections: selectionCount, maximumSelections: selectionCount, minimumLength: type === 'OPEN_TEXT' ? 1 : null, maximumLength: type === 'OPEN_TEXT' ? 2_000 : null }, variableName: questionId.toLowerCase(), analysisRole, provenance: { class: provenanceClass, sourceIds }, reviewFlags };
  return items.length ? { ...base, items } : base;
}

function blockedQuestionnaireFor(input, researchDesign, issues, templateSupported) {
  const blockingIssues = Array.isArray(issues) ? issues : [issues];
  return { instrumentVersion: 'human-instrument-v1', title: '', language: instrumentLocaleFor(input), languageValidation: { status: 'HUMAN_TRANSLATION_REVIEW_REQUIRED', templateLocaleSupported: templateSupported, respondentFacingCopySource: 'NONE_BLOCKED', blockingIssues }, estimatedMinutes: null, hasPlaceholders: true, stimuli: [], questions: [], primaryScaleId: researchDesign.scale?.id || null, disclosure: '' };
}

function stimulus({ stimulusId, type, text, reviewFlags = ['PRESENT_EXACTLY_AS_SUPPLIED'], ...rest }) {
  return { stimulusId, type, text, provenance: 'USER_INPUT', reviewFlags, ...rest };
}

function monitorCategories(categories) {
  return categories.map(({ value, share }) => ({
    code: value,
    referenceShare: share,
  }));
}

function buildGeneralLikertQuestions({ input, frame, copy, questions }) {
  questions.push(question({ questionId: 'Q_PRIMARY', order: 30, type: 'SINGLE_SELECT', text: frame.neutralQuestion || input.prompt, options: optionRows(copy.likelihood), analysisRole: 'PRIMARY_OUTCOME', provenanceClass: frame.neutralQuestion ? 'MODEL_FRAMING' : 'USER_INPUT', reviewFlags: ['COGNITIVE_PRETEST_REQUIRED', 'HUMAN_TRANSLATION_REVIEW_REQUIRED'] }));
  questions.push(question({ questionId: 'Q_INFLUENCE', order: 40, type: 'OPEN_TEXT', text: copy.influence, analysisRole: 'OPEN_END' }));
}

function buildConceptTestQuestions({ input, copy, questions, stimuli }) {
  const concept = input.methodConfig.concept;
  stimuli.push(stimulus({ stimulusId: concept.id, type: 'CONCEPT', text: concept.text }));
  questions.push(question({ questionId: 'Q_STIMULUS', order: 10, type: 'STIMULUS', text: copy.conceptInstruction, analysisRole: 'CLASSIFICATION', stimulusId: concept.id, sourceIds: [concept.id] }));
  questions.push(question({ questionId: 'Q_COMPREHENSION', order: 20, type: 'OPEN_TEXT', text: copy.comprehension, analysisRole: 'SECONDARY_OUTCOME', sourceIds: [concept.id] }));
  questions.push(question({ questionId: 'Q_PRIMARY', order: 30, type: 'SINGLE_SELECT', text: copy.conceptPrimary, options: optionRows(copy.likelihood), analysisRole: 'PRIMARY_OUTCOME', sourceIds: [concept.id], reviewFlags: ['COGNITIVE_PRETEST_REQUIRED', 'HUMAN_TRANSLATION_REVIEW_REQUIRED'] }));
  questions.push(question({ questionId: 'Q_INFLUENCE', order: 40, type: 'OPEN_TEXT', text: copy.influence, analysisRole: 'OPEN_END', sourceIds: [concept.id] }));
  questions.push(question({ questionId: 'Q_OBJECTIONS', order: 50, type: 'OPEN_TEXT', text: copy.objections, analysisRole: 'OPEN_END', sourceIds: [concept.id] }));
}

function buildPurchaseIntentQuestions({ input, copy, questions, stimuli }) {
  const config = input.methodConfig;
  questions.push(question({ questionId: 'Q_CATEGORY_CONTEXT', order: 5, type: 'SINGLE_SELECT', text: copy.category(config.category, config.purchaseHorizon), options: optionRows([copy.yes, copy.no]), analysisRole: 'CLASSIFICATION', provenanceClass: 'USER_INPUT', reviewFlags: ['DO_NOT_TERMINATE_UNLESS_AUDIENCE_DEFINITION_REQUIRES_IT'] }));
  questions.push(question({ questionId: 'Q_RECENT_BEHAVIOR', order: 6, type: 'OPEN_TEXT', text: copy.recent(config.category), analysisRole: 'CLASSIFICATION', provenanceClass: 'USER_INPUT' }));
  const stimulusText = `${config.offer.text}\n${priceLabel(config.price.amount, config.price.currency, config.price.unit)}\n${config.channel}\n${config.purchaseHorizon}\n${config.referenceAlternative}`;
  stimuli.push(stimulus({ stimulusId: config.offer.id, type: 'PRICED_OFFER', text: stimulusText, price: { ...config.price }, channel: config.channel, purchaseHorizon: config.purchaseHorizon, referenceAlternative: config.referenceAlternative }));
  questions.push(question({ questionId: 'Q_STIMULUS', order: 10, type: 'STIMULUS', text: copy.offerInstruction, analysisRole: 'CLASSIFICATION', stimulusId: config.offer.id, sourceIds: [config.offer.id] }));
  questions.push(question({ questionId: 'Q_COMPREHENSION', order: 20, type: 'OPEN_TEXT', text: copy.comprehension, analysisRole: 'SECONDARY_OUTCOME', sourceIds: [config.offer.id] }));
  questions.push(question({ questionId: 'Q_PRIMARY', order: 30, type: 'SINGLE_SELECT', text: copy.purchasePrimary(config.purchaseHorizon), options: optionRows(copy.purchase), analysisRole: 'PRIMARY_OUTCOME', sourceIds: [config.offer.id], reviewFlags: ['COGNITIVE_PRETEST_REQUIRED', 'HUMAN_TRANSLATION_REVIEW_REQUIRED'] }));
  questions.push(question({ questionId: 'Q_INFLUENCE', order: 40, type: 'OPEN_TEXT', text: copy.influence, analysisRole: 'OPEN_END', sourceIds: [config.offer.id] }));
  questions.push(question({ questionId: 'Q_ALTERNATIVE', order: 50, type: 'OPEN_TEXT', text: copy.alternative, analysisRole: 'SECONDARY_OUTCOME', provenanceClass: 'USER_INPUT' }));
  questions.push(question({ questionId: 'Q_VALUE', order: 60, type: 'OPEN_TEXT', text: copy.value, analysisRole: 'SECONDARY_OUTCOME', sourceIds: [config.offer.id] }));
  questions.push(question({ questionId: 'Q_BARRIER', order: 70, type: 'OPEN_TEXT', text: copy.purchaseBarrier, analysisRole: 'OPEN_END', sourceIds: [config.offer.id] }));
}

function buildMessageTestQuestions({ input, copy, questions, stimuli }) {
  const config = input.methodConfig;
  stimuli.push(stimulus({ stimulusId: config.message.id, type: 'MESSAGE', text: config.message.text, intendedAction: config.intendedAction, exposureContext: config.exposureContext || null }));
  questions.push(question({ questionId: 'Q_STIMULUS', order: 10, type: 'STIMULUS', text: copy.messageInstruction, analysisRole: 'CLASSIFICATION', stimulusId: config.message.id, sourceIds: [config.message.id] }));
  questions.push(question({ questionId: 'Q_COMPREHENSION', order: 20, type: 'OPEN_TEXT', text: copy.comprehension, analysisRole: 'SECONDARY_OUTCOME', sourceIds: [config.message.id] }));
  questions.push(question({ questionId: 'Q_PRIMARY', order: 30, type: 'SINGLE_SELECT', text: copy.messagePrimary(config.intendedAction), options: optionRows(copy.messageScale), analysisRole: 'PRIMARY_OUTCOME', sourceIds: [config.message.id], reviewFlags: ['COGNITIVE_PRETEST_REQUIRED', 'HUMAN_TRANSLATION_REVIEW_REQUIRED'] }));
  questions.push(question({ questionId: 'Q_INFLUENCE', order: 40, type: 'OPEN_TEXT', text: copy.influence, analysisRole: 'OPEN_END', sourceIds: [config.message.id] }));
  questions.push(question({ questionId: 'Q_OBJECTIONS', order: 50, type: 'OPEN_TEXT', text: copy.objections, analysisRole: 'OPEN_END', sourceIds: [config.message.id] }));
}

function buildClaimsTestQuestions({ input, copy, questions, stimuli }) {
  const config = input.methodConfig;
  stimuli.push(stimulus({ stimulusId: config.claim.id, type: 'CLAIM', text: config.claim.text, declaredClaimStatus: config.claimStatus }));
  questions.push(question({ questionId: 'Q_STIMULUS', order: 10, type: 'STIMULUS', text: copy.claimInstruction, analysisRole: 'CLASSIFICATION', stimulusId: config.claim.id, sourceIds: [config.claim.id] }));
  questions.push(question({ questionId: 'Q_COMPREHENSION', order: 20, type: 'OPEN_TEXT', text: copy.comprehension, analysisRole: 'SECONDARY_OUTCOME', sourceIds: [config.claim.id] }));
  questions.push(question({ questionId: 'Q_PRIMARY', order: 30, type: 'SINGLE_SELECT', text: copy.claimPrimary(config.claimStatus), options: optionRows(copy.claimScale), analysisRole: 'PRIMARY_OUTCOME', sourceIds: [config.claim.id], reviewFlags: ['COGNITIVE_PRETEST_REQUIRED', 'HUMAN_TRANSLATION_REVIEW_REQUIRED', 'SUBSTANTIATION_REVIEW_REQUIRED'] }));
  questions.push(question({ questionId: 'Q_INFLUENCE', order: 40, type: 'OPEN_TEXT', text: copy.influence, analysisRole: 'OPEN_END', sourceIds: [config.claim.id] }));
  questions.push(question({ questionId: 'Q_CLAIM_CLARITY', order: 50, type: 'OPEN_TEXT', text: copy.claimClarity, analysisRole: 'OPEN_END', sourceIds: [config.claim.id] }));
}

function buildUxExpectationQuestions({ input, copy, questions, stimuli }) {
  const config = input.methodConfig;
  stimuli.push(stimulus({ stimulusId: config.taskScenario.id, type: 'UX_TASK_SCENARIO', text: config.taskScenario.text, userGoal: config.userGoal, experienceDescription: config.experienceDescription, context: config.context || null, device: config.device || null }));
  questions.push(question({ questionId: 'Q_STIMULUS', order: 10, type: 'STIMULUS', text: copy.uxInstruction, analysisRole: 'CLASSIFICATION', stimulusId: config.taskScenario.id, sourceIds: [config.taskScenario.id] }));
  questions.push(question({ questionId: 'Q_COMPREHENSION', order: 20, type: 'OPEN_TEXT', text: copy.comprehension, analysisRole: 'SECONDARY_OUTCOME', sourceIds: [config.taskScenario.id] }));
  questions.push(question({ questionId: 'Q_PRIMARY', order: 30, type: 'SINGLE_SELECT', text: copy.uxPrimary(config.userGoal), options: optionRows(copy.easeScale), analysisRole: 'PRIMARY_OUTCOME', sourceIds: [config.taskScenario.id], reviewFlags: ['COGNITIVE_PRETEST_REQUIRED', 'HUMAN_TRANSLATION_REVIEW_REQUIRED', 'SELF_REPORTED_EXPECTATION_ONLY', 'OBSERVED_TASK_VALIDATION_SEPARATE'] }));
  questions.push(question({ questionId: 'Q_INFLUENCE', order: 40, type: 'OPEN_TEXT', text: copy.influence, analysisRole: 'OPEN_END', sourceIds: [config.taskScenario.id] }));
  questions.push(question({ questionId: 'Q_EXPECTED_FRICTION', order: 50, type: 'OPEN_TEXT', text: copy.uxFriction, analysisRole: 'OPEN_END', sourceIds: [config.taskScenario.id] }));
}

function buildFeaturePrioritizationQuestions({ input, copy, questions, stimuli }) {
  const config = input.methodConfig;
  const features = config.features.map((feature) => ({ id: feature.id, text: feature.text }));
  for (const feature of features) stimuli.push(stimulus({ stimulusId: feature.id, type: 'FEATURE', text: feature.text }));
  questions.push(question({ questionId: 'Q_STIMULUS', order: 10, type: 'STIMULUS', text: copy.featureInstruction, analysisRole: 'CLASSIFICATION', sourceIds: features.map((feature) => feature.id) }));
  questions.push(question({ questionId: 'Q_PRIMARY', order: 30, type: 'RANK_ORDER', text: copy.featurePrimary(config.selectionConstraint), options: itemOptionRows(features), analysisRole: 'PRIMARY_OUTCOME', sourceIds: features.map((feature) => feature.id), items: itemRows(features), reviewFlags: ['COGNITIVE_PRETEST_REQUIRED', 'HUMAN_TRANSLATION_REVIEW_REQUIRED', 'TRADEOFF_DESIGN_REVIEW_REQUIRED'] }));
  questions.push(question({ questionId: 'Q_PRIORITY_REASON', order: 40, type: 'OPEN_TEXT', text: copy.featureReason, analysisRole: 'OPEN_END', sourceIds: features.map((feature) => feature.id) }));
}

function buildBrandPositioningQuestions({ input, copy, questions, stimuli }) {
  const config = input.methodConfig;
  const brands = [config.focalBrand, ...config.comparatorBrands].map((brand) => ({ id: brand.id, label: brand.label }));
  const attributes = config.attributes.map((attribute) => ({ id: attribute.id, label: attribute.label }));
  for (const brand of brands) stimuli.push(stimulus({ stimulusId: brand.id, type: brand.id === config.focalBrand.id ? 'FOCAL_BRAND' : 'COMPARATOR_BRAND', text: brand.label }));
  questions.push(question({ questionId: 'Q_STIMULUS', order: 10, type: 'STIMULUS', text: copy.brandInstruction, analysisRole: 'CLASSIFICATION', sourceIds: [...brands.map((brand) => brand.id), ...attributes.map((attribute) => attribute.id)] }));
  questions.push(question({ questionId: 'Q_PRIMARY', order: 30, type: 'MATRIX_SINGLE_SELECT', text: copy.brandPrimary(config.category), options: itemOptionRows(brands, 'label'), analysisRole: 'PRIMARY_OUTCOME', sourceIds: [...brands.map((brand) => brand.id), ...attributes.map((attribute) => attribute.id)], items: itemRows(attributes, 'label'), reviewFlags: ['COGNITIVE_PRETEST_REQUIRED', 'HUMAN_TRANSLATION_REVIEW_REQUIRED', 'COMPARATOR_NEUTRALITY_REVIEW_REQUIRED', 'BRAND_FAMILIARITY_AND_OPT_OUT_REVIEW_REQUIRED', 'MATRIX_ORDER_REVIEW_REQUIRED'] }));
  questions.push(question({ questionId: 'Q_BRAND_REASON', order: 40, type: 'OPEN_TEXT', text: copy.brandReason, analysisRole: 'OPEN_END', sourceIds: [...brands.map((brand) => brand.id), ...attributes.map((attribute) => attribute.id)] }));
}

function buildPriceSensitivityQuestions({ input, copy, questions, stimuli }) {
  const config = input.methodConfig;
  const pricePoints = config.pricePoints.map((point) => ({
    itemId: point.id,
    amount: point.amount,
    currency: config.currency,
    unit: config.unit,
    text: priceLabel(point.amount, config.currency, config.unit),
  }));
  stimuli.push(stimulus({ stimulusId: config.offer.id, type: 'PRICE_LADDER_OFFER', text: `${config.offer.text}\n${config.category}\n${config.channel}\n${config.purchaseHorizon}\n${config.referenceAlternative}`, category: config.category, currency: config.currency, unit: config.unit, channel: config.channel, purchaseHorizon: config.purchaseHorizon, referenceAlternative: config.referenceAlternative }));
  questions.push(question({ questionId: 'Q_STIMULUS', order: 10, type: 'STIMULUS', text: copy.priceInstruction, analysisRole: 'CLASSIFICATION', stimulusId: config.offer.id, sourceIds: [config.offer.id, ...pricePoints.map((point) => point.itemId)] }));
  questions.push(question({ questionId: 'Q_COMPREHENSION', order: 20, type: 'OPEN_TEXT', text: copy.comprehension, analysisRole: 'SECONDARY_OUTCOME', sourceIds: [config.offer.id] }));
  questions.push(question({ questionId: 'Q_PRIMARY', order: 30, type: 'MATRIX_SINGLE_SELECT', text: copy.pricePrimary(config.purchaseHorizon), options: optionRows(copy.purchase), analysisRole: 'PRIMARY_OUTCOME', sourceIds: [config.offer.id, ...pricePoints.map((point) => point.itemId)], items: pricePoints, reviewFlags: ['COGNITIVE_PRETEST_REQUIRED', 'HUMAN_TRANSLATION_REVIEW_REQUIRED', 'SIMULTANEOUS_ASCENDING_PRICE_PRESENTATION', 'PRICE_EXPOSURE_DESIGN_REVIEW_REQUIRED'] }));
  questions.push(question({ questionId: 'Q_PRICE_REASON', order: 40, type: 'OPEN_TEXT', text: copy.priceReason, analysisRole: 'OPEN_END', sourceIds: [config.offer.id, ...pricePoints.map((point) => point.itemId)] }));
  questions.push(question({ questionId: 'Q_ALTERNATIVE', order: 50, type: 'OPEN_TEXT', text: copy.alternative, analysisRole: 'SECONDARY_OUTCOME', provenanceClass: 'USER_INPUT' }));
  questions.push(question({ questionId: 'Q_BARRIER', order: 60, type: 'OPEN_TEXT', text: copy.purchaseBarrier, analysisRole: 'OPEN_END', sourceIds: [config.offer.id] }));
}

function buildSurveyPretestQuestions({ input, copy, questions, stimuli }) {
  const config = input.methodConfig;
  const surveyQuestions = config.surveyQuestions.map((surveyQuestion) => ({ id: surveyQuestion.id, text: surveyQuestion.text }));
  for (const surveyQuestion of surveyQuestions) stimuli.push(stimulus({ stimulusId: surveyQuestion.id, type: 'SURVEY_QUESTION', text: surveyQuestion.text }));
  questions.push(question({ questionId: 'Q_STIMULUS', order: 10, type: 'STIMULUS', text: copy.surveyPretestInstruction, analysisRole: 'CLASSIFICATION', sourceIds: surveyQuestions.map((surveyQuestion) => surveyQuestion.id) }));
  questions.push(question({ questionId: 'Q_PRIMARY', order: 30, type: 'OPEN_TEXT', text: copy.surveyPretestPrimary, analysisRole: 'PRIMARY_OUTCOME', sourceIds: surveyQuestions.map((surveyQuestion) => surveyQuestion.id), items: itemRows(surveyQuestions), reviewFlags: ['COGNITIVE_PRETEST_REQUIRED', 'HUMAN_TRANSLATION_REVIEW_REQUIRED', 'INSTRUMENT_REVIEW_REQUIRED'] }));
  questions.push(question({ questionId: 'Q_REVISION_PROBE', order: 40, type: 'OPEN_TEXT', text: copy.surveyPretestProbe, analysisRole: 'OPEN_END', sourceIds: surveyQuestions.map((surveyQuestion) => surveyQuestion.id) }));
}

function buildInterviewGuideQuestions({ input, copy, questions }) {
  const config = input.methodConfig;
  const topics = config.topics.map((topic) => ({ id: topic.id, label: topic.label }));
  questions.push(question({ questionId: 'Q_MODERATOR_OPENING', order: 10, type: 'INSTRUCTION', text: copy.interviewIntro, analysisRole: 'CLASSIFICATION', required: false, sourceIds: topics.map((topic) => topic.id), reviewFlags: ['CONSENT_PRIVACY_REVIEW_REQUIRED'] }));
  topics.forEach((topic, index) => {
    questions.push(question({ questionId: index === 0 ? 'Q_PRIMARY' : `Q_TOPIC_${topic.id}`, order: 30 + index, type: 'OPEN_TEXT', text: copy.topicPrompt(topic.label), analysisRole: 'PRIMARY_OUTCOME', sourceIds: [topic.id], items: [{ itemId: topic.id, text: topic.label }], reviewFlags: ['MODERATOR_REVIEW_REQUIRED', 'HUMAN_TRANSLATION_REVIEW_REQUIRED'] }));
  });
  if (config.sensitiveAreas?.length) questions.push(question({ questionId: 'Q_SENSITIVE_AREAS', order: 80, type: 'INSTRUCTION', text: copy.sensitiveAreas(config.sensitiveAreas), analysisRole: 'CLASSIFICATION', required: false, reviewFlags: ['SENSITIVE_DATA_REVIEW_REQUIRED'] }));
  questions.push(question({ questionId: 'Q_INTERVIEW_CLOSE', order: 90, type: 'OPEN_TEXT', text: copy.interviewClose, analysisRole: 'OPEN_END' }));
}

const METHOD_BUILDERS = {
  GENERAL_LIKERT: buildGeneralLikertQuestions,
  CONCEPT_TEST: buildConceptTestQuestions,
  PURCHASE_INTENT: buildPurchaseIntentQuestions,
  MESSAGE_TEST: buildMessageTestQuestions,
  CLAIMS_TEST: buildClaimsTestQuestions,
  UX_EXPECTATION_TEST: buildUxExpectationQuestions,
  FEATURE_PRIORITIZATION: buildFeaturePrioritizationQuestions,
  BRAND_POSITIONING: buildBrandPositioningQuestions,
  PRICE_SENSITIVITY: buildPriceSensitivityQuestions,
  SURVEY_PRETEST: buildSurveyPretestQuestions,
  INTERVIEW_GUIDE: buildInterviewGuideQuestions,
};

function questionnaireFor(input, frame, researchDesign) {
  const instrumentLocale = instrumentLocaleFor(input);
  const templateSupported = templateLocaleSupported(instrumentLocale);
  const copy = copyFor(instrumentLocale);
  if (!templateSupported || !copy) return blockedQuestionnaireFor(input, researchDesign, 'UNSUPPORTED_HANDOFF_LOCALE_REQUIRES_HUMAN_TRANSLATION', false);
  if (!methodConfigIsUsable(input.researchMethod, input.methodConfig)) return blockedQuestionnaireFor(input, researchDesign, SPECIALIZED_METHODS.has(input.researchMethod) ? 'METHOD_CONFIG_REQUIRED_FOR_HANDOFF' : 'METHOD_SPECIFIC_HANDOFF_TEMPLATE_MISSING', true);
  const userCopyIssues = respondentFacingUserCopyIssues(input, frame);
  if (userCopyIssues.length) return blockedQuestionnaireFor(input, researchDesign, userCopyIssues, true);
  const questions = [question({ questionId: 'S_CONSENT', order: 1, type: 'SINGLE_SELECT', text: copy.consent, options: optionRows([copy.yes, copy.no]), analysisRole: 'SCREENER' })];
  const stimuli = [];
  METHOD_BUILDERS[input.researchMethod]({ input, frame, researchDesign, copy, questions, stimuli });
  questions.push(question({ questionId: 'Q_CLOSE', order: 99, type: 'INSTRUCTION', text: copy.close, analysisRole: 'CLASSIFICATION', required: false }));
  return { instrumentVersion: 'human-instrument-v1', title: copy.methodTitles[input.researchMethod] || copy.title, language: instrumentLocale, languageValidation: { status: 'HUMAN_TRANSLATION_REVIEW_REQUIRED', templateLocaleSupported: true, respondentFacingCopySource: 'METHOD_TEMPLATE_AND_USER_STIMULUS' }, estimatedMinutes: null, hasPlaceholders: true, stimuli, questions, primaryScaleId: researchDesign.scale?.id || null, disclosure: DRAFT_DISCLOSURE };
}

function primaryEstimandFor(input) {
  switch (input.researchMethod) {
    case 'CONCEPT_TEST': return { variable: 'q_primary', construct: 'CONCEPT_ADOPTION_INTENT', statistics: ['FULL_DISTRIBUTION', 'TOP_TWO_BOX'], topTwoCodes: ['4', '5'] };
    case 'PURCHASE_INTENT': return { variable: 'q_primary', construct: 'STATED_PURCHASE_INTENT_FOR_EXACT_OFFER', statistics: ['FULL_DISTRIBUTION', 'TOP_TWO_BOX'], topTwoCodes: ['4', '5'] };
    case 'MESSAGE_TEST': return { variable: 'q_primary', construct: 'MESSAGE_COMPELLINGNESS', statistics: ['FULL_DISTRIBUTION', 'TOP_TWO_BOX'], topTwoCodes: ['4', '5'] };
    case 'CLAIMS_TEST': return { variable: 'q_primary', construct: 'CLAIM_BELIEVABILITY', statistics: ['FULL_DISTRIBUTION', 'TOP_TWO_BOX'], topTwoCodes: ['4', '5'] };
    case 'UX_EXPECTATION_TEST': return { variable: 'q_primary', construct: 'EXPECTED_TASK_EASE', statistics: ['FULL_DISTRIBUTION', 'TOP_TWO_BOX'], topTwoCodes: ['4', '5'] };
    case 'FEATURE_PRIORITIZATION': return { variable: 'q_primary', construct: 'FEATURE_PRIORITY_RANKING', statistics: ['FULL_RANK_ORDER', 'FIRST_RANK_COUNT', 'MEAN_RANK'], topTwoCodes: null };
    case 'BRAND_POSITIONING': return { variable: 'q_primary', construct: 'BRAND_ATTRIBUTE_ASSOCIATION', statistics: ['ATTRIBUTE_BRAND_SELECTION_MATRIX'], topTwoCodes: null };
    case 'PRICE_SENSITIVITY': return { variable: 'q_primary', construct: 'STATED_PURCHASE_INTENT_BY_SUPPLIED_PRICE', statistics: ['FULL_DISTRIBUTION_BY_PRICE_POINT', 'TOP_TWO_BOX_BY_PRICE_POINT'], topTwoCodes: ['4', '5'] };
    case 'SURVEY_PRETEST': return { variable: 'q_primary', construct: 'QUESTION_COMPREHENSION_AND_REVISION_NEEDS', statistics: ['QUESTION_COMPREHENSION_ISSUES', 'REVISION_THEMES'], topTwoCodes: null };
    case 'INTERVIEW_GUIDE': return { variable: 'q_primary', construct: 'INTERVIEW_GUIDE_PILOT_QUALITY', statistics: ['GUIDE_PILOT_FEEDBACK', 'TOPIC_COVERAGE', 'REVISION_NEEDS'], topTwoCodes: null };
    default: return { variable: 'q_primary', construct: 'FIVE_POINT_DIRECTIONAL_RESPONSE', statistics: ['FULL_DISTRIBUTION', 'TOP_TWO_BOX'], topTwoCodes: ['4', '5'] };
  }
}

function samplePlanFor(input) {
  const method = input.researchMethod;
  if (method === 'GENERAL_LIKERT' || !methodConfigIsUsable(method, input.methodConfig)) {
    return {
      status: 'BLOCKED',
      reviewStatus: 'PENDING',
      basis: 'METHOD_SPECIFIC_DESIGN_REQUIRED',
      recommendedCompletes: null,
      recommendedRange: null,
      unit: null,
      parameters: null,
      calculation: null,
      interpretation: 'NO_DEFENSIBLE_SAMPLE_RECOMMENDATION',
      recommendationCode: 'CONFIGURE_SUPPORTED_METHOD_BEFORE_SIZING',
      recommendationKind: 'NONE',
      analysisUnit: null,
      scope: null,
      precisionClaimAllowed: false,
      requiredInputs: ['A supported specialized research method', 'A complete method configuration'],
      recommendation: 'Choose and configure a supported research method before setting a sample-size target.',
      disclosure: 'No numeric sample recommendation is produced for a blocked or generic instrument.',
    };
  }
  if (NOMINAL_PROPORTION_METHODS.has(method)) {
    const recommendedCompletes = 385;
    return {
      status: 'PLANNING_ESTIMATE',
      reviewStatus: 'PENDING',
      basis: 'NOMINAL_SINGLE_PROPORTION_PRECISION',
      recommendedCompletes,
      recommendedRange: null,
      unit: 'COMPLETED_QUESTIONNAIRES',
      recommendationCode: method === 'UX_EXPECTATION_TEST' ? 'NOMINAL_EXPECTATION_SURVEY_REFERENCE_ONLY' : 'NOMINAL_FULL_SAMPLE_PROPORTION_REFERENCE_ONLY',
      recommendationKind: 'POINT_REFERENCE',
      analysisUnit: 'ANALYZABLE_COMPLETE',
      scope: 'FULL_SAMPLE_PRIMARY_PROPORTION',
      precisionClaimAllowed: false,
      samplingDesignStatus: 'UNKNOWN',
      parameters: { confidenceLevel: 0.95, zScore: 1.96, assumedProportion: 0.5, nominalPrecisionPp: 5, designEffect: null, designEffectStatus: 'UNKNOWN' },
      calculation: { formula: 'ceil(z² × p × (1-p) / e²)', baseCompletes: recommendedCompletes, subgroupMinimumAdjustment: null, finitePopulationCorrectionApplied: false },
      interpretation: 'NOMINAL_SRS_EQUIVALENT_NOT_GUARANTEED',
      requiredInputs: ['Expected incidence and nonresponse', 'Recruitment design', 'Planned subgroup contrasts', 'Design effect or effective-sample-size assumptions'],
      recommendation: method === 'UX_EXPECTATION_TEST'
        ? 'Treat 385 as a nominal full-sample reference for the expected-ease self-report only. Size an observed usability study separately from its task protocol, participant variation, accessibility needs, and iteration plan.'
        : 'Treat 385 as a nominal full-sample single-proportion reference only; recalculate for the actual recruitment, subgroup, weighting, and analysis design.',
      disclosure: `This is a nominal simple-random-sample-equivalent calculation under stated assumptions, not a recommended field target, synthetic confidence interval, human result, or guarantee of precision. Recruitment method, weighting, exclusions, nonresponse, and subgroup analysis can reduce effective information.${method === 'UX_EXPECTATION_TEST' ? ' Expected ease is not observed usability.' : ''}`,
    };
  }
  if (COMPLEX_QUANTITATIVE_METHODS.has(method)) {
    return {
      status: 'RESEARCHER_DESIGN_REQUIRED',
      reviewStatus: 'PENDING',
      basis: method === 'FEATURE_PRIORITIZATION' ? 'RANK_OR_CHOICE_DESIGN_POWER_REQUIRED'
        : method === 'BRAND_POSITIONING' ? 'BRAND_ATTRIBUTE_MATRIX_PRECISION_REQUIRED'
          : 'REPEATED_PRICE_RESPONSE_DESIGN_POWER_REQUIRED',
      recommendedCompletes: null,
      recommendedRange: null,
      unit: 'COMPLETED_QUESTIONNAIRES',
      recommendationCode: method === 'FEATURE_PRIORITIZATION' ? 'FREEZE_RANK_OR_CHOICE_DESIGN_BEFORE_SIZING'
        : method === 'BRAND_POSITIONING' ? 'FREEZE_BRAND_MATRIX_DESIGN_BEFORE_SIZING'
          : 'FREEZE_PRICE_EXPOSURE_DESIGN_BEFORE_SIZING',
      recommendationKind: 'DESIGN_INSTRUCTION',
      analysisUnit: 'ANALYZABLE_COMPLETE',
      scope: 'METHOD_SPECIFIC_PRIMARY_ESTIMAND',
      precisionClaimAllowed: false,
      samplingDesignStatus: 'NOT_FROZEN',
      parameters: null,
      calculation: null,
      interpretation: 'NO_UNIVERSAL_SAMPLE_SIZE',
      requiredInputs: method === 'FEATURE_PRIORITIZATION'
        ? ['Final rank, MaxDiff, or conjoint design', 'Number of items and tasks', 'Smallest decision-relevant difference', 'Planned subgroup contrasts', 'Expected exclusions and design effect']
        : method === 'BRAND_POSITIONING'
          ? ['Final brand and attribute matrix', 'Brand-familiarity incidence', 'Smallest decision-relevant association difference', 'Planned subgroup contrasts', 'Expected exclusions and design effect']
          : ['Final randomized price-exposure design', 'Smallest decision-relevant intent difference', 'Within-person response correlation if repeated measures are used', 'Planned subgroup contrasts', 'Expected exclusions and design effect'],
      recommendation: 'Have a researcher calculate the target from the frozen design, estimand, smallest decision-relevant difference, multiplicity policy, subgroup plan, and expected effective sample size.',
      disclosure: 'Likerts does not invent a universal numeric target for a rank, matrix, or repeated-price design. The design must be frozen before a defensible power or precision calculation is possible.',
    };
  }
  if (QUALITATIVE_METHODS.has(method)) {
    return {
      status: 'RESEARCHER_DESIGN_REQUIRED',
      reviewStatus: 'PENDING',
      basis: method === 'SURVEY_PRETEST' ? 'ITERATIVE_COGNITIVE_PRETEST_PLAN_REQUIRED' : 'PURPOSIVE_QUALITATIVE_SAMPLING_PLAN_REQUIRED',
      recommendedCompletes: null,
      recommendedRange: null,
      unit: method === 'SURVEY_PRETEST' ? 'COMPLETED_COGNITIVE_INTERVIEWS' : 'COMPLETED_INTERVIEWS',
      recommendationCode: method === 'SURVEY_PRETEST' ? 'PLAN_ITERATIVE_COGNITIVE_PRETEST_ROUNDS' : 'PLAN_PURPOSIVE_GUIDE_PILOT_AND_STOPPING_RULE',
      recommendationKind: 'DESIGN_INSTRUCTION',
      analysisUnit: 'COMPLETED_REVIEW_SESSION',
      scope: method === 'SURVEY_PRETEST' ? 'QUESTIONNAIRE_COGNITIVE_PRETEST' : 'INTERVIEW_GUIDE_PILOT',
      precisionClaimAllowed: false,
      samplingDesignStatus: 'NOT_FROZEN',
      parameters: null,
      calculation: null,
      interpretation: 'STOPPING_RULE_AND_COVERAGE_PLAN_REQUIRED',
      requiredInputs: method === 'SURVEY_PRETEST'
        ? ['Questionnaire complexity and routing', 'Priority participant variations', 'Iterative revision rounds', 'Predeclared issue-resolution or stopping rule']
        : ['Purposive sampling dimensions', 'Priority participant variations', 'Topic complexity', 'Predeclared information-power or stopping rule'],
      recommendation: method === 'SURVEY_PRETEST'
        ? 'Plan iterative cognitive-interview rounds across the priority participant variations, revising between rounds and documenting the stopping rule.'
        : 'Set a purposive interview plan from the research objective, participant variation, topic complexity, analysis depth, and a documented stopping rule.',
      disclosure: 'A qualitative interview count is not a precision calculation. Likerts leaves the numeric target unset until a researcher defines the sampling and stopping logic.',
    };
  }
  return {
    status: 'BLOCKED', reviewStatus: 'PENDING', basis: 'METHOD_SPECIFIC_DESIGN_REQUIRED', recommendedCompletes: null, recommendedRange: null, unit: null, parameters: null, calculation: null,
    interpretation: 'NO_DEFENSIBLE_SAMPLE_RECOMMENDATION', recommendationCode: 'CONFIGURE_SUPPORTED_METHOD_BEFORE_SIZING', recommendationKind: 'NONE', analysisUnit: null, scope: null, precisionClaimAllowed: false, requiredInputs: ['A supported specialized research method'], recommendation: 'Choose a supported method and complete its design.', disclosure: 'No numeric sample recommendation is available for this method.',
  };
}

function reportingFor(method) {
  const common = ['PARTICIPANT_DISPOSITIONS', 'EXCLUSIONS', 'BREAKOFF'];
  if (NOMINAL_PROPORTION_METHODS.has(method)) return ['UNWEIGHTED_BASES', 'WEIGHTED_BASES_IF_APPLICABLE', 'FULL_DISTRIBUTIONS', 'TOP_TWO_BOX_WITH_BASES', ...common, 'OBSERVED_INCIDENCE'];
  if (method === 'FEATURE_PRIORITIZATION') return ['UNWEIGHTED_BASES', 'FULL_RANK_ORDERS', 'FIRST_RANK_COUNTS', 'MEAN_RANKS', ...common, 'OBSERVED_INCIDENCE'];
  if (method === 'BRAND_POSITIONING') return ['UNWEIGHTED_BASES', 'ATTRIBUTE_BRAND_SELECTION_MATRIX', 'FORCED_CHOICE_LIMITATION', ...common, 'OBSERVED_INCIDENCE'];
  if (method === 'PRICE_SENSITIVITY') return ['UNWEIGHTED_BASES', 'FULL_DISTRIBUTIONS_BY_PRICE_POINT', 'TOP_TWO_BOX_BY_PRICE_POINT_WITH_BASES', 'PRESENTATION_ORDER_LIMITATION', ...common, 'OBSERVED_INCIDENCE'];
  if (method === 'SURVEY_PRETEST') return ['PARTICIPANT_CHARACTERISTICS', 'QUESTION_COMPREHENSION_ISSUES', 'RESPONSE_MAPPING_ISSUES', 'REVISION_THEMES', 'ITERATION_HISTORY', ...common];
  if (method === 'INTERVIEW_GUIDE') return ['PARTICIPANT_CHARACTERISTICS', 'GUIDE_PILOT_FEEDBACK', 'TOPIC_COVERAGE', 'QUESTION_SEQUENCE_ISSUES', 'SENSITIVE_TOPIC_HANDLING', 'REVISION_LOG', ...common];
  return common;
}

function weightingPlanFor(method) {
  if (QUALITATIVE_METHODS.has(method)) return { status: 'NOT_APPLICABLE', method: 'NONE', targets: [], weightTrimmingRule: null };
  return { status: 'TARGETS_UNAVAILABLE', method: 'NONE', targets: [], weightTrimmingRule: null };
}

function executionModeFor(method) {
  if (NOMINAL_PROPORTION_METHODS.has(method)) return 'QUANT_SURVEY';
  if (COMPLEX_QUANTITATIVE_METHODS.has(method)) return 'QUANT_COMPLEX_DESIGN';
  if (method === 'SURVEY_PRETEST') return 'COGNITIVE_PRETEST';
  if (method === 'INTERVIEW_GUIDE') return 'INTERVIEW_GUIDE_PILOT';
  return 'BLOCKED';
}

function sourceCoverageDate(populationFrame, marginal) {
  return populationFrame.officialSourceDatasets?.find((source) => source.id === marginal.sourceDatasetId)?.coverageDate || populationFrame.coverageDate || null;
}

function quotaPlanFor(input, populationFrame) {
  const marginals = populationFrame.marginalDistributions || [];
  if (QUALITATIVE_METHODS.has(input.researchMethod)) {
    return {
      status: 'NOT_APPLICABLE',
      targetCompletes: null,
      targets: [],
      monitorTargets: [],
      coverageDimensions: marginals.map((marginal) => ({
        coverageId: `coverage-${marginal.variable}`,
        type: 'PURPOSIVE_COVERAGE_REFERENCE',
        variable: marginal.variable,
        label: marginal.label,
        sourceDatasetId: marginal.sourceDatasetId,
        coverageDate: sourceCoverageDate(populationFrame, marginal),
        categories: marginal.categories.map(({ value, share }) => ({ code: value, sourceShare: share })),
      })),
      weightingPlan: { status: 'NOT_APPLICABLE', method: 'NONE', targets: [], realisedWeightEffectiveSampleSize: null, disclosure: 'Weighting is not applied to a cognitive pretest or interview-guide pilot.' },
      disclosure: 'Statistical quotas are not applicable to this qualitative planning mode. A researcher must define purposive coverage across relevant participant variations; official population shares are context, not recruitment targets.',
      denominatorReviewRequired: false,
      samplingCoverageReviewRequired: true,
    };
  }
  return {
    status: 'TARGETS_UNAVAILABLE',
    targetCompletes: null,
    targets: [],
    monitorTargets: marginals.map((marginal) => ({ quotaId: `monitor-${marginal.variable}`, type: 'POPULATION_REFERENCE_ONLY', variable: marginal.variable, label: marginal.label, denominatorMatch: 'UNVERIFIED', captureSource: 'REQUIRES_QUESTIONNAIRE_OR_PROVIDER_MAPPING', collectionStatus: 'NOT_INCLUDED_IN_INSTRUMENT', sourceDatasetId: marginal.sourceDatasetId, coverageDate: sourceCoverageDate(populationFrame, marginal), categories: monitorCategories(marginal.categories) })),
    coverageDimensions: [],
    weightingPlan: { status: 'TARGETS_UNAVAILABLE', method: 'NONE', targets: [], realisedWeightEffectiveSampleSize: null, disclosure: 'No weighting variable is activated until a questionnaire item or provider metadata field is mapped to the exact target categories and the denominator is reviewed.' },
    disclosure: 'No defensible achieved-sample quota is available until source denominators are shown to match the screened intended population. Population shares are reference values, not quotas. Quotas and weighting do not make an opt-in or non-probability panel representative.',
    denominatorReviewRequired: true,
    samplingCoverageReviewRequired: false,
  };
}

function recruitmentPlanFor(method) {
  if (method === 'SURVEY_PRETEST') {
    return {
      instructionSet: 'COGNITIVE_PRETEST',
      instructions: ['Have a human researcher review the cognitive-interview protocol and every supplied survey item.', 'Complete applicable ethics, privacy, consent, accessibility, recording, and data-protection review.', 'Recruit purposively across the participant variations most likely to change comprehension or response mapping.', 'Run iterative rounds, record item-level comprehension and response-mapping issues, and revise between rounds.', 'Freeze an issue-resolution or stopping rule before declaring the pretest complete.', 'Keep pilot feedback separate from substantive survey findings.'],
      providerRelationship: 'LINK_ONLY_NOT_INTEGRATED', noPanelBooked: true,
      disclosure: 'No participant recruitment is booked or connected. Provider links are suggestions, not endorsements or integrations; audience availability, accessibility, compensation, timing, and terms must be confirmed directly.',
    };
  }
  if (method === 'INTERVIEW_GUIDE') {
    return {
      instructionSet: 'QUALITATIVE_INTERVIEWS',
      instructions: ['Have a human researcher review and pilot the interview guide before substantive fieldwork.', 'Complete applicable ethics, privacy, consent, accessibility, recording, safeguarding, and data-protection review.', 'Recruit purposively across the participant variations relevant to the guide objective.', 'Pilot the sequence, probes, timing, sensitive-topic handling, and moderator instructions.', 'Document revisions and a stopping rule for guide piloting before substantive interviews begin.', 'Do not analyze guide-pilot answers as substantive participant findings.'],
      providerRelationship: 'LINK_ONLY_NOT_INTEGRATED', noPanelBooked: true,
      disclosure: 'No participant recruitment is booked or connected. Provider links are suggestions, not endorsements or integrations; audience availability, accessibility, compensation, timing, and terms must be confirmed directly.',
    };
  }
  return {
    instructionSet: 'SURVEY_FIELDING',
    instructions: ['Have a human researcher review and cognitively pretest the instrument.', 'Complete applicable ethics, privacy, consent, accessibility, and data-protection review.', 'Ask providers for feasibility using the exact screener and population-reference dimensions; do not share synthetic segment labels as recruitable identities.', 'Run a small soft launch before full fielding.', 'Freeze duplicate, speeding, straight-lining, open-text quality, exclusion, and weighting rules before inspecting substantive outcomes.', 'Monitor incidence, recruitment progress, breakoff, exclusions, and respondent compensation.'],
    providerRelationship: 'LINK_ONLY_NOT_INTEGRATED', noPanelBooked: true,
    disclosure: 'No participant panel is booked or connected. Provider links are suggestions, not endorsements or integrations; audience availability, feasibility, price, timing, and terms must be confirmed directly.',
  };
}

function methodProtocolFor(input) {
  if (input.researchMethod === 'BRAND_POSITIONING') return { mode: 'FORCED_CHOICE_BRAND_ATTRIBUTE_MATRIX', familiarityMeasured: false, noneOrNotSureOptionIncluded: false, orderRandomized: false, reviewStatus: 'RESEARCHER_DESIGN_REQUIRED', disclosure: 'The draft is a forced-choice matrix. Brand familiarity, a none/not-sure response, neutral ordering, randomization, and denominator rules must be reviewed before fielding.' };
  if (input.researchMethod === 'PRICE_SENSITIVITY') return { mode: 'SIMULTANEOUS_DESCRIPTIVE_PRICE_LADDER', presentationOrder: 'ASCENDING_AS_SUPPLIED', randomized: false, reviewStatus: 'RESEARCHER_DESIGN_REQUIRED', disclosure: 'The draft presents every supplied price in ascending order. It is not a randomized monadic or Gabor–Granger design; a researcher must define exposure, branching, allocation, and order capture before using those methods.' };
  if (input.researchMethod === 'UX_EXPECTATION_TEST') return { mode: 'EXPECTATION_SURVEY', observedTaskTestIncluded: false, reviewStatus: 'FOLLOW_ON_VALIDATION_REQUIRED', disclosure: 'The handoff measures expected ease only. It does not observe task success, time, assistance, friction, or accessibility outcomes; size and run an observed task study separately if usability validation is intended.' };
  if (input.researchMethod === 'INTERVIEW_GUIDE') return { mode: 'INTERVIEW_GUIDE_PILOT', substantiveFindingsPermitted: false, reviewStatus: 'RESEARCHER_DESIGN_REQUIRED', disclosure: 'Pilot responses are used to revise the guide and are not substantive participant findings.' };
  return null;
}

function missingFieldsFor(input, samplePlan) {
  const fields = ['Human translation and locale review', 'Observed or provider-quoted incidence', 'Survey duration after cognitive pretest', 'Provider feasibility, price, and timing'];
  if (QUALITATIVE_METHODS.has(input.researchMethod)) {
    fields.push('Method-specific sample-size or qualitative stopping-rule design');
  } else {
    fields.push('Defensible achieved-sample quota targets');
    if (samplePlan.status === 'RESEARCHER_DESIGN_REQUIRED') fields.push('Method-specific sample-size or qualitative stopping-rule design');
    fields.push('Preregistered subgroup power requirements');
  }
  if (input.researchMethod === 'BRAND_POSITIONING') fields.push('Brand familiarity, none/not-sure handling, and neutral matrix order');
  if (input.researchMethod === 'PRICE_SENSITIVITY') fields.push('Price exposure, branching, allocation, and presentation-order plan');
  if (input.researchMethod === 'UX_EXPECTATION_TEST') fields.push('Observed task protocol if usability validation is intended');
  fields.push('Ethics, privacy, and jurisdictional approval status');
  return fields;
}

export function buildHumanResearchHandoff({ input, frame, researchDesign, populationFrame, study, reproducibility, evidenceCatalog = [], studyId, runId, generatedAt }) {
  const reportLocale = reportLocaleFor(input);
  const instrumentLocale = instrumentLocaleFor(input);
  const executionMode = executionModeFor(input.researchMethod);
  const samplePlan = samplePlanFor(input);
  const quotaPlan = quotaPlanFor(input, populationFrame);
  const recruitmentPlan = recruitmentPlanFor(input.researchMethod);
  const methodProtocol = methodProtocolFor(input);
  const questionnaire = questionnaireFor(input, frame, researchDesign);
  const blockingIssues = handoffBlockingIssues(input, frame);
  const researchGrounding = {
    status: evidenceCatalog.some((entry) => entry.sourceKind) ? 'UNVERIFIED_MATERIALS_INCLUDED' : 'NONE',
    materials: evidenceCatalog.filter((entry) => entry.sourceKind).map((entry) => ({ evidenceId: entry.id, clientMaterialId: entry.clientMaterialId, title: entry.title, sourceKind: entry.sourceKind, contentHandling: entry.contentHandling, detectedType: entry.detectedType, declaredMime: entry.declaredMime || null, verificationStatus: entry.verificationStatus, clientReportedContentHash: entry.clientContentHash, serverExcerptHash: entry.contentHash, originalCharacterCount: entry.originalCharacterCount, truncated: entry.truncated })),
    disclosure: 'Client-reported content hashes identify browser-supplied material but do not authenticate its origin. Server excerpt hashes identify the bounded text used in this run.',
  };
  const sourceStudy = { studyId, runId, inputHash: reproducibility.inputHash, evidenceHash: reproducibility.evidenceHash, populationFrameHash: reproducibility.populationFrameHash, researchDesignHash: reproducibility.researchDesignHash, modelCardHash: reproducibility.modelCardHash, researchMethod: input.researchMethod, researchMethodVersion: researchDesign.methodVersion, runtimeVersion: reproducibility.runtimeVersion, promptVersions: reproducibility.promptVersions, schemaVersions: reproducibility.schemaVersions, modelRoutes: reproducibility.modelRoutes, market: input.market, outputLocale: input.outputLocale, reportLocale, instrumentLocale, localizationReceipt: input.localization || null, sampleLineage: input.sampleLineage || null, observedHumanResponses: false };
  const handoffId = `hrh_${sha256(JSON.stringify(sourceStudy)).slice(0, 24)}`;
  const purchaseDisclosure = input.researchMethod === 'PURCHASE_INTENT' ? 'Stated purchase intent is not observed conversion, demand, revenue, or market size.' : null;
  const handoff = {
    schemaVersion: HUMAN_RESEARCH_HANDOFF_VERSION,
    handoffId,
    generatedAt,
    status: blockingIssues.length ? 'BLOCKED' : 'READY_FOR_RESEARCHER_REVIEW',
    blockingIssues,
    contentStatus: blockingIssues.length ? 'BLOCKED_REQUIRES_QUESTIONNAIRE_REVISION' : 'FIELD_DRAFT_REQUIRES_REVIEW',
    boundary: HUMAN_RESEARCH_BOUNDARY,
    executionMode,
    sourceStudy,
    researchGrounding,
    intendedPopulation: populationFrame.intendedPopulation,
    geography: populationFrame.geography,
    questionnaire,
    screeningPlan: {
      criteria: [
        { criterionId: 'CONSENT', source: 'METHOD_TEMPLATE', status: 'DRAFT', rationale: 'Participation requires informed consent.', questionId: 'S_CONSENT' },
        { criterionId: 'AUDIENCE_ELIGIBILITY', source: 'USER_INPUT', status: 'REQUIRES_RESEARCHER_OPERATIONALIZATION', rationale: input.audience, questionId: null },
      ],
      terminationLogic: [{ ruleId: 'TERM_CONSENT', when: { questionId: 'S_CONSENT', operator: 'EQ', values: ['2'] }, action: 'TERMINATE_NO_CONSENT', reasonCode: 'CONSENT_NOT_GRANTED', denominatorTreatment: 'EXCLUDE_BEFORE_RESEARCH_PARTICIPANT_AND_ELIGIBILITY_DENOMINATORS' }],
      sensitiveDataReviewRequired: true,
      consentPrivacyReviewRequired: true,
      reviewStatus: 'PENDING',
    },
    quotaPlan,
    samplePlan,
    incidencePlan: { status: 'UNESTIMATED', reviewStatus: 'PENDING', pointEstimate: null, range: null, basis: 'NONE', source: null, disclosure: 'Incidence is unknown unless supported by a cited observed source or dated provider quote. Synthetic response percentages are never used to estimate eligibility.' },
    recruitmentPlan,
    analysisPlan: {
      version: 'human-analysis-plan-v1',
      executionMode,
      primaryEstimand: primaryEstimandFor(input),
      methodProtocol,
      populations: { eligible: populationFrame.intendedPopulation, analysis: 'Eligible participants meeting the frozen quality and exclusion rules.' },
      dispositions: { noConsent: 'Excluded before research-participant, eligibility, incidence, and analysis denominators.' },
      exclusions: ['Researcher-preregistered duplicate and data-quality failures among consented participants'],
      missingData: { itemNonresponse: 'REPORT_AND_EXCLUDE_FROM_ITEM_DENOMINATOR' },
      weighting: weightingPlanFor(input.researchMethod),
      subgroupContrasts: [],
      openTextCoding: input.researchMethod === 'INTERVIEW_GUIDE'
        ? { planned: false, purpose: 'GUIDE_PILOT_REVISION_NOT_SUBSTANTIVE_THEMATIC_ANALYSIS', codebookCreatedBlindToSyntheticResult: null, doubleCoding: 'NOT_APPLICABLE' }
        : { planned: true, codebookCreatedBlindToSyntheticResult: true, doubleCoding: 'NOT_PLANNED' },
      syntheticComparison: { role: 'SECONDARY', humanAnalysisFrozenBeforeComparison: true },
      multiplicityPolicy: 'DESCRIPTIVE_ONLY',
      reporting: reportingFor(input.researchMethod),
      methodChecks: researchDesign.humanValidation?.minimumChecks || [],
      methodRecommendation: researchDesign.humanValidation?.recommendedMethod || null,
      analysisReviewRequired: true,
      reviewStatus: 'PENDING',
    },
    providerLinks: [
      { providerId: 'PROLIFIC', name: 'Prolific', relationship: 'LINK_ONLY_NOT_INTEGRATED', suitability: 'POSSIBLE_MATCH', url: 'https://researcher-help.prolific.com/en/articles/445252-what-is-my-target-population', limitations: ['Representative-sample options and prescreeners vary by market and must be confirmed directly.'] },
      { providerId: 'CINT', name: 'Cint', relationship: 'LINK_ONLY_NOT_INTEGRATED', suitability: 'POSSIBLE_MATCH', url: 'https://www.cint.com/solutions/source-respondents/', limitations: ['Audience availability, feasibility, price, timing, and terms must be confirmed directly.'] },
    ],
    unsupportedCharacteristics: populationFrame.unsupportedCharacteristics || [],
    missingFields: missingFieldsFor(input, samplePlan),
    syntheticHypothesesForResearcherReview: (study.cautions || []).map((text) => ({ text, provenance: 'SYNTHETIC_HYPOTHESIS', permittedUse: 'OPTIONAL_NON_TERMINATING_PROBE_ONLY' })),
    disclosures: [HUMAN_RESEARCH_BOUNDARY, questionnaire.disclosure, purchaseDisclosure].filter(Boolean),
  };
  const packageParts = {
    questionnaire: handoff.questionnaire,
    screener: handoff.screeningPlan,
    quota: { quotaPlan: handoff.quotaPlan, samplePlan: handoff.samplePlan, incidencePlan: handoff.incidencePlan },
    recruitment: handoff.recruitmentPlan,
    analysis: handoff.analysisPlan,
    sourceLineage: handoff.sourceStudy,
  };
  const packageHashes = humanResearchPackageHashes(packageParts);
  const lifecycleBlockers = [
    ...(questionnaire.languageValidation.status === 'HUMAN_TRANSLATION_REVIEW_REQUIRED' ? ['TRANSLATION_REVIEW'] : []),
    ...(questionnaire.hasPlaceholders ? ['QUESTIONNAIRE_REVIEW'] : []),
    ...(questionnaire.stimuli.some((stimulus) => stimulus.reviewFlags?.length) ? ['STIMULUS_REVIEW'] : []),
    'SAMPLE_DESIGN_REVIEW',
    'CONSENT_PRIVACY_REVIEW',
    ...(QUALITATIVE_METHODS.has(input.researchMethod) ? ['SAMPLING_COVERAGE_REVIEW'] : ['DENOMINATOR_REVIEW']),
    ...(input.researchMethod === 'BRAND_POSITIONING' ? ['BRAND_MATRIX_DESIGN_REVIEW'] : []),
    ...(input.researchMethod === 'PRICE_SENSITIVITY' ? ['PRICE_EXPOSURE_DESIGN_REVIEW'] : []),
    ...(input.researchMethod === 'CLAIMS_TEST' ? ['CLAIM_SUBSTANTIATION_REVIEW'] : []),
    'ANALYSIS_REVIEW',
  ];
  return {
    ...handoff,
    packageVersion: 'human-research-package-v1',
    packageHashes,
    lifecycle: { contractVersion: 'human-research-lifecycle-v1', status: 'DRAFT', version: 1, blockingIssues: [...new Set(lifecycleBlockers)], approval: null },
  };
}
