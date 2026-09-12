import React, {useEffect, useState} from 'react';
import {AppRegistry, Text, View} from 'react-native';
import {LikertsClient, LIKERTS_SDK_CAPABILITY} from '../src';

function HostedApp(config) {
  const [status, setStatus] = useState('HOSTED WAIT');
  useEffect(() => {
    let live = true;
    const cancel = new AbortController();
    let stage = 'configuration';
    (async () => {
      try {
        if (config.target !== 'react_native' || config.sdkVersion !== LIKERTS_SDK_CAPABILITY.sdkVersion ||
            config.disposable !== true || config.responseCap !== 1) throw Error();
        const client = new LikertsClient(config.baseUrl, config.collectionToken, undefined, 10000);
        stage = 'collection';
        const collection = await client.collection(config.collectionId, {refresh: true, signal: cancel.signal});
        if (collection.id !== config.collectionId || !collection.schema.questions.some(q => q.id === 'rating' && q.type === 'scale')) throw Error();
        const submission = Object.freeze({idempotencyKey: config.idempotencyKey, answers: {rating: 5}, metadata: {source: 'synthetic-native-hosted', target: 'react_native'}});
        stage = 'submit';
        const receipt = await client.submit(config.collectionId, submission, {signal: cancel.signal});
        if (receipt.collectionId !== config.collectionId || !receipt.accepted || !receipt.responseId) throw Error();
        stage = 'identical_retry';
        const retry = await client.submit(config.collectionId, submission, {signal: cancel.signal});
        if (retry.collectionId !== receipt.collectionId || retry.responseId !== receipt.responseId || retry.accepted !== receipt.accepted) throw Error();
        if (live) setStatus('HOSTED PASS ' + JSON.stringify({target:'react_native',sdkVersion:'0.0.3',result:'passed',collectionId:receipt.collectionId,responseId:receipt.responseId,identicalRetrySameReceipt:true,sdkRequests:3,boundary:'same-team synthetic native transport; ledger verified separately'}));
      } catch (_) { if (live) setStatus('HOSTED FAIL ' + stage); }
    })();
    return () => { live = false; cancel.abort(); };
  }, []);
  return <View style={{padding:30,paddingTop:80}}><Text testID="hosted-status" accessibilityLabel={status}>{status}</Text></View>;
}
AppRegistry.registerComponent('LikertsNativeAcceptance', () => HostedApp);
