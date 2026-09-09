import React, {useState} from 'react';
import {Button, View} from 'react-native';
import {LikertsClient, SurveyHost, type Receipt} from '@likerts/react-native';

export function CheckoutFeedback({client, collectionId, eligible, createIdempotencyKey, onComplete}: {
  client: LikertsClient; collectionId: string; eligible: boolean;
  createIdempotencyKey: () => string; onComplete: (receipt: Receipt) => void;
}) {
  const [visible, setVisible] = useState(false);
  if (!eligible) return null;
  return <View>
    <Button title="Give feedback" onPress={() => setVisible(true)} />
    {visible && <SurveyHost client={client} collectionId={collectionId}
      createIdempotencyKey={createIdempotencyKey} metadata={{placement: 'receipt'}}
      onComplete={receipt => {setVisible(false); onComplete(receipt);}} />}
    {visible && <Button title="Dismiss" onPress={() => setVisible(false)} />}
  </View>;
}
