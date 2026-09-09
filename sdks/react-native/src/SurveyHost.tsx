import React, {useEffect, useRef, useState} from 'react';
import {Text} from 'react-native';
import type {Answer, Collection, LikertsClient, Receipt, Submission} from './index';
import {Survey, SurveyProps} from './Survey';

export interface SurveyHostMessages {loading:string;loadError:string;submitError:string}
export interface SurveyHostProps {
  client:LikertsClient;collectionId:string;createIdempotencyKey:()=>string;metadata?:Record<string,unknown>;
  onComplete:(receipt:Receipt)=>void;onError?:(error:unknown)=>void;refreshOnMount?:boolean;
  messages?:Partial<SurveyHostMessages>;surveyProps?:Omit<SurveyProps,'collection'|'onSubmit'|'disabled'|'submitting'>;
}
const defaults:SurveyHostMessages={loading:'Loading survey…',loadError:'Could not load survey.',submitError:'Could not confirm submission. Try again without changing the answers.'};

/** Optional host adapter: owns cancellable loading/submission while Survey remains usable on its own. */
export function SurveyHost({client,collectionId,createIdempotencyKey,metadata={},onComplete,onError,refreshOnMount=false,messages:overrides,surveyProps={}}:SurveyHostProps){
  const messages={...defaults};for(const key of Object.keys(defaults) as (keyof SurveyHostMessages)[]){const value=overrides?.[key];if(typeof value==='string')messages[key]=value}const [collection,setCollection]=useState<Collection>();const [error,setError]=useState('');const [submitting,setSubmitting]=useState(false);const [completed,setCompleted]=useState(false);
  const pending=useRef<{serialized:string;submission:Submission}|undefined>(undefined);const generation=useRef(0);const activeSubmit=useRef<AbortController|undefined>(undefined);
  useEffect(()=>{const current=++generation.current;const controller=new AbortController();activeSubmit.current?.abort();setCollection(undefined);setError('');setCompleted(false);pending.current=undefined;
    client.collection(collectionId,{refresh:refreshOnMount,signal:controller.signal}).then(value=>{if(generation.current===current)setCollection(value)}).catch(cause=>{if(!controller.signal.aborted&&generation.current===current){setError(messages.loadError);onError?.(cause)}});
    return()=>{generation.current++;controller.abort();activeSubmit.current?.abort()};
  },[client,collectionId,refreshOnMount]);
  const changed=(answers:Record<string,Answer>)=>{if(pending.current?.serialized!==JSON.stringify(answers))pending.current=undefined;surveyProps.onAnswersChange?.(answers)};
  const submit=async(answers:Record<string,Answer>)=>{if(!collection||submitting||completed)return;const serialized=JSON.stringify(answers);if(!pending.current)pending.current={serialized,submission:{idempotencyKey:createIdempotencyKey(),answers:JSON.parse(serialized),metadata:JSON.parse(JSON.stringify(metadata))}};const current=++generation.current;const controller=new AbortController();activeSubmit.current=controller;setSubmitting(true);setError('');
    try{const receipt=await client.submit(collection.id,pending.current.submission,{signal:controller.signal});if(generation.current===current){setCompleted(true);onComplete(receipt)}}
    catch(cause){if(generation.current===current){setError(messages.submitError);onError?.(cause)}}
    finally{if(activeSubmit.current===controller)activeSubmit.current=undefined;if(generation.current===current)setSubmitting(false)}
  };
  if(!collection)return <Text testID="likerts-host-status" accessibilityRole={error?'alert':undefined} accessibilityLiveRegion="polite">{error||messages.loading}</Text>;
  return <><Survey {...surveyProps} collection={collection} onSubmit={submit} onAnswersChange={changed} disabled={completed} submitting={submitting}/>{error?<Text testID="likerts-host-error" accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>:null}</>;
}
