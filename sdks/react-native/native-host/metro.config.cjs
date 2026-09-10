const path=require('node:path');
const {getDefaultConfig}=require('metro-config');
module.exports=(async()=>{
 const root=path.resolve(__dirname,'..');
 const config=await getDefaultConfig(root);
 return {...config,projectRoot:root,watchFolders:[root],maxWorkers:2,
  resolver:{...config.resolver,resolverMainFields:['react-native','browser','main'],sourceExts:['js','jsx','json','ts','tsx'],unstable_enablePackageExports:true},
  serializer:{...config.serializer,getPolyfills:()=>require('react-native/rn-get-polyfills')(),getModulesRunBeforeMainModule:()=>[require.resolve('react-native/Libraries/Core/InitializeCore')]},
  transformer:{...config.transformer,enableBabelRCLookup:true,getTransformOptions:async()=>({transform:{experimentalImportSupport:false,inlineRequires:true}})}
 };
})();
