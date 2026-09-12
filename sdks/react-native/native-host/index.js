import React, {useState} from 'react';
import {AppRegistry, ScrollView, Text, View, StyleSheet} from 'react-native';
import {Survey} from '../src';
const collection={id:'native-host',surveyId:'native',version:1,placement:'fixture',schema:{schemaVersion:5,title:'Likerts native acceptance',questions:[
  {id:'rank',type:'ranking',label:'Priority',required:true,options:[{id:'a',label:'A'},{id:'b',label:'B'}]},
  {id:'matrix',type:'matrix',label:'Experience',required:true,rows:[{id:'r',label:'Service'}],columns:[{id:'one',label:'One'},{id:'two',label:'Two'}],matrixMode:'single'},
  {id:'sum',type:'constant_sum',label:'Allocate',required:true,items:[{id:'x',label:'X'},{id:'y',label:'Y'}],total:100}
]}};
const expected=JSON.stringify({rank:['b','a'],matrix:{r:'two'},sum:{x:60,y:40}});
function App(){
 const [result,setResult]=useState('Awaiting native interaction');
 const [submissions,setSubmissions]=useState(0);
 return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
  <Text testID="host-status" accessibilityLabel={result} style={styles.title}>{result}</Text>
  <Survey collection={collection} testID="acceptance" styles={{title:styles.title,question:styles.question,label:styles.label,choice:styles.choice,input:styles.input,submit:styles.submit,submitText:styles.submitText,error:styles.error}}
    onSubmit={answers=>{const count=submissions+1;setSubmissions(count);setResult(JSON.stringify(answers)===expected && count===1?'NATIVE PASS — exact answers, one submission':'NATIVE FAIL — '+JSON.stringify(answers));}}/>
 </ScrollView>;
}
const styles=StyleSheet.create({page:{backgroundColor:'#fff'},content:{padding:24,paddingTop:48,paddingBottom:80},title:{fontSize:22,color:'#111',marginBottom:18},question:{marginBottom:22},label:{fontSize:18,fontWeight:'600',marginBottom:8,color:'#111'},choice:{padding:12},input:{borderWidth:1,borderColor:'#777',color:'#111',padding:10,marginVertical:8,minHeight:48},submit:{padding:16,backgroundColor:'#315cff',marginTop:12},submitText:{color:'#fff',fontSize:18},error:{color:'#9b1717'}});
AppRegistry.registerComponent('LikertsNativeAcceptance',()=>App);
