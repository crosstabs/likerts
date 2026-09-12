import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,cp,rm,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,dirname,relative} from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const version=(await readFile(join(root,'sdks/RELEASE-VERSION'),'utf8')).trim();
assert.match(version,/^\d+\.\d+\.\d+$/);
assert.notEqual(version,'0.0.1','Release 0.0.1 is frozen; generate a distinct newer release instead.');
const compatibility=JSON.parse(await readFile(join(root,'contracts/sdk-compatibility.json'),'utf8'));
const releaseSchemas=compatibility.currentFleet.installations[0].schemaVersions;
assert.ok(compatibility.currentFleet.installations.every(item=>item.sdkVersion===version && JSON.stringify(item.schemaVersions)===JSON.stringify(releaseSchemas)),'Release version and schema declarations must match across all five SDKs');
const out=join(root,'releases',version),work=join(root,'.tools',`sdk-install-${process.pid}`);
await mkdir(out,{recursive:true});await mkdir(work,{recursive:true});
assert.equal(await stat(join(out,'manifest.json')).then(()=>true,()=>false),false,'A successful release manifest is immutable; increment RELEASE-VERSION instead of overwriting artifacts.');
const artifacts=[],checks=[];
const json=async(path,value)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(value,null,2)+'\n');};
const run=(command,args,cwd=root,env={})=>new Promise((resolve,reject)=>{
  console.log(`Running ${command} ${args.join(' ')} in ${relative(root,cwd)||'.'}`);
  const child=spawn(command,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let stdout='';
  child.stdout.on('data',chunk=>{stdout+=chunk;process.stdout.write(chunk)});child.stderr.on('data',chunk=>process.stderr.write(chunk));
  child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(new Error(`${command} exited ${code}`)));
});
const packageJson=async path=>JSON.parse(await readFile(path,'utf8'));
const allFiles=async dir=>{const found=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())found.push(...await allFiles(path));else if(entry.isFile())found.push(path);else throw new Error(`Unexpected nonregular release file ${path}`);}return found;};
const artifact=async(path,kind)=>{const bytes=await readFile(path);artifacts.push({file:relative(out,path),kind,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});};

try {
  for(const target of ['web','react-native']){
    const source=join(root,'sdks',target),pkg=await packageJson(join(source,'package.json'));
    assert.equal(pkg.version,version);assert.equal(pkg.private,true,'Public registry publication is outside this gate');
    if(target==='react-native')assert.ok((await readFile(join(source,'src/index.ts'),'utf8')).includes(`sdkVersion:'${version}'`));
    await rm(join(source,target==='web'?'dist':'lib'),{recursive:true,force:true});
    await run('npm',['ci','--ignore-scripts'],source);await run('npm',['run','build'],source);
    const packed=JSON.parse(await run('npm',['pack','--json','--ignore-scripts','--pack-destination',out],source))[0];
    for(const file of packed.files){assert.ok(/^(?:package\.json|README\.md|CHANGELOG\.md|LICENSE)$|^(?:dist|lib|src|examples)\//.test(file.path),`Unexpected npm artifact file ${file.path}`);assert.ok(!/(^|\/)(\.env|node_modules|test)(\/|$)/.test(file.path));}
    const tarball=join(out,packed.filename);await artifact(tarball,`npm-${target}`);
    const consumer=join(work,target);await mkdir(consumer,{recursive:true});
    const dependencies={[pkg.name]:`file:${tarball}`};
    const devDependencies={typescript:'5.9.3'};
    if(target==='web')devDependencies.jsdom='26.1.0';
    else Object.assign(dependencies,{react:'19.2.3','react-native':'0.86.3'}),Object.assign(devDependencies,{'@types/react':'19.2.2','@babel/core':'7.28.0','@react-native/babel-preset':'0.86.3'});
    await json(join(consumer,'package.json'),{name:`likerts-${target}-install-probe`,version:'1.0.0',private:true,type:'module',dependencies,devDependencies});
    await run('npm',['install','--ignore-scripts','--no-audit','--no-fund'],consumer);
    await cp(join(consumer,'node_modules',pkg.name,'examples'),join(consumer,'src'),{recursive:true});
    await json(join(consumer,'tsconfig.json'),{compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',strict:true,skipLibCheck:true,lib:['ES2022','DOM'],outDir:'compiled'},include:['src']});
    await run(join(consumer,'node_modules/.bin/tsc'),['--project','tsconfig.json'],consumer);
    if(target==='web'){
      await writeFile(join(consumer,'probe.mjs'),`import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {LIKERTS_SDK_CAPABILITY,LikertsClient,mountSurvey} from '@likerts/web';import {OfflineQueue} from '@likerts/web/offline';import {attachCheckoutFeedback} from './compiled/checkout.js';assert.equal(LIKERTS_SDK_CAPABILITY.sdkVersion,${JSON.stringify(version)});assert.deepEqual(LIKERTS_SDK_CAPABILITY.schemaVersions,${JSON.stringify(releaseSchemas)});assert.equal(typeof mountSurvey,'function');assert.equal(typeof OfflineQueue,'function');const dom=new JSDOM('<button>Feedback</button><div></div>');const cleanup=attachCheckoutFeedback(dom.window.document.querySelector('button'),dom.window.document.querySelector('div'),new LikertsClient('https://api.example.com','synthetic-collection-token'),'collection-id',()=>{});cleanup();dom.window.close();console.log('Installed Web public exports, offline subpath and trigger cleanup passed');`);
      await run('node',['probe.mjs'],consumer);
    }else{
      await writeFile(join(consumer,'probe.cjs'),`const fs=require('node:fs'),assert=require('node:assert/strict'),babel=require('@babel/core');const root='node_modules/@likerts/react-native/';const pkg=JSON.parse(fs.readFileSync(root+'package.json'));assert.equal(pkg.version,${JSON.stringify(version)});assert.equal(pkg.exports['.']['react-native'],'./src/index.ts');assert.equal(pkg.exports['./offline']['react-native'],'./src/offline.ts');assert.ok(fs.existsSync(root+'lib/offline.d.ts'));for(const file of fs.readdirSync(root+'src').filter(name=>/\\.tsx?$/.test(name)).map(name=>'src/'+name))assert.ok(babel.transformFileSync(root+file,{presets:['module:@react-native/babel-preset'],babelrc:false,configFile:false}).code);assert.ok(babel.transformFileSync('src/CheckoutFeedback.tsx',{presets:['module:@react-native/babel-preset'],babelrc:false,configFile:false}).code);console.log('Installed React Native source entry, offline subpath, declarations and host trigger passed');`);
      await run('node',['probe.cjs'],consumer);
    }
    checks.push({target,passed:true,verification:target==='web'?'Fresh npm tarball install, TypeScript consumer, public exports and DOM trigger setup/cleanup':'Fresh npm tarball install with RN 0.86.3/React 19.2.3, TypeScript consumer and Babel native source/trigger compilation'});
  }

  const swiftStage=join(work,'swift-artifact','Likerts');await mkdir(swiftStage,{recursive:true});
  for(const file of ['Package.swift','Sources','Tests','README.md','CHANGELOG.md','InstallationExample'])await cp(join(root,'sdks/ios',file),join(swiftStage,file),{recursive:true});
  // Keep the source package's included tests runnable without a repository checkout.
  await mkdir(join(swiftStage,'contracts'));
  for (const name of ['survey.example.json','sdk-behavior.json','sdk-compatibility.json','response.example.json','conditional-survey.example.json','branching-survey.example.json','expanded-survey.example.json','choice-features.json','choice-survey.example.json','advanced-survey.example.json']) await cp(join(root,'contracts',name),join(swiftStage,'contracts',name));
  for (const file of await allFiles(join(swiftStage,'Tests'))) {
    const source=await readFile(file,'utf8');
    await writeFile(file,source.replace(/URL\(fileURLWithPath:\s*#filePath\)(?:\s*\.deletingLastPathComponent\(\)){5}/g,'URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()'));
  }
  assert.ok((await readFile(join(swiftStage,'Sources/Likerts/Likerts.swift'),'utf8')).includes(`sdkVersion: "${version}"`));
  const swiftTar=join(out,`Likerts-ios-${version}.tar.gz`);await run('tar',['-czf',swiftTar,'-C',dirname(swiftStage),'Likerts']);await artifact(swiftTar,'swift-package-source');
  const swiftExtract=join(work,'swift-clean');await mkdir(swiftExtract);await run('tar',['-xzf',swiftTar,'-C',swiftExtract]);
  await run('swift',['test','--package-path',join(swiftExtract,'Likerts')]);
  const swiftConsumer=join(swiftExtract,'Consumer');await mkdir(join(swiftConsumer,'Sources/InstallProbe'),{recursive:true});
  await writeFile(join(swiftConsumer,'Package.swift'),`// swift-tools-version: 5.9\nimport PackageDescription\nlet package = Package(name: "InstallProbe", platforms: [.macOS(.v12)], dependencies: [.package(path: "../Likerts")], targets: [.executableTarget(name: "InstallProbe", dependencies: [.product(name: "Likerts", package: "Likerts")])])\n`);
  await cp(join(swiftExtract,'Likerts/InstallationExample/CheckoutFeedback.swift'),join(swiftConsumer,'Sources/InstallProbe/CheckoutFeedback.swift'));
  await writeFile(join(swiftConsumer,'Sources/InstallProbe/main.swift'),`import Likerts\nprecondition(likertsSDKCapability.sdkVersion == "${version}")\nprecondition(likertsSDKCapability.schemaVersions == ${JSON.stringify(releaseSchemas)})\n_ = OfflineQueue.self\n_ = AdvancedQuestions.self\nprint("Installed Swift package, advanced/offline APIs, public model and SwiftUI trigger compiled")\n`);
  await run('swift',['run','--package-path',swiftConsumer,'InstallProbe']);
  checks.push({target:'ios',passed:true,verification:'Fresh extraction, packaged fixture/test suite, independent SwiftPM consumer compilation/run and SwiftUI trigger compilation on macOS; existing iOS-target/device gates remain separate'});

  const jdkName=(await readdir(join(root,'.tools/jdk'))).find(name=>name.startsWith('jdk-17'));
  const env={JAVA_HOME:process.env.JAVA_HOME??join(root,'.tools/jdk',jdkName,'Contents/Home'),ANDROID_HOME:process.env.ANDROID_HOME??join(root,'.tools/android-sdk'),GRADLE_USER_HOME:process.env.GRADLE_USER_HOME??join(root,'.tools/gradle-home')};
  const gradle=process.env.GRADLE_COMMAND??join(root,'.tools/gradle-8.11.1/bin/gradle');
  const maven=join(out,'maven');await mkdir(maven,{recursive:true});
  assert.ok((await readFile(join(root,'sdks/android/src/main/kotlin/com/likerts/sdk/Likerts.kt'),'utf8')).includes(`"android", "${version}"`));
  await run(gradle,['--no-daemon','-p',join(root,'sdks/android'),`-PlikertsReleaseRepository=${maven}`,'publishReleasePublicationToLocalReleaseRepository'],root,env);
  const androidGuide=join(out,'android-guide');await mkdir(androidGuide,{recursive:true});
  for(const name of ['README.md','CHANGELOG.md'])await cp(join(root,'sdks/android',name),join(androidGuide,name));
  await cp(join(root,'sdks/android/installation-example/CheckoutFeedback.kt'),join(androidGuide,'CheckoutFeedback.kt'));
  const androidTar=join(out,`likerts-android-maven-${version}.tar.gz`);await run('tar',['-czf',androidTar,'-C',out,'maven','android-guide']);await artifact(androidTar,'android-maven-repository');
  const androidClean=join(work,'android-clean');await mkdir(androidClean);await run('tar',['-xzf',androidTar,'-C',androidClean]);
  const androidConsumer=join(androidClean,'Consumer');await mkdir(join(androidConsumer,'src/main/kotlin/com/likerts/installprobe'),{recursive:true});
  await writeFile(join(androidConsumer,'settings.gradle.kts'),`pluginManagement { repositories { gradlePluginPortal(); google(); mavenCentral() } }\ndependencyResolutionManagement { repositories { maven { url = uri("../maven") }; google(); mavenCentral() } }\nrootProject.name = "likerts-installed-consumer"\n`);
  await writeFile(join(androidConsumer,'build.gradle.kts'),`plugins { id("com.android.application") version "8.9.2"; kotlin("android") version "2.1.20"; kotlin("plugin.compose") version "2.1.20" }\nandroid { namespace="com.likerts.installprobe"; compileSdk=35; defaultConfig { applicationId="com.likerts.installprobe"; minSdk=26; targetSdk=35; versionCode=1; versionName="1.0" }; buildFeatures { compose=true }; compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 } }\nkotlin { jvmToolchain(17) }\ndependencies { implementation("com.likerts:likerts-android:${version}"); implementation(platform("androidx.compose:compose-bom:2025.04.01")); implementation("androidx.compose.material3:material3") }\n`);
  await writeFile(join(androidConsumer,'gradle.properties'),'android.useAndroidX=true\norg.gradle.jvmargs=-Xmx1536m\n');
  await writeFile(join(androidConsumer,'src/main/AndroidManifest.xml'),'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="Install probe" /></manifest>\n');
  await cp(join(androidClean,'android-guide/CheckoutFeedback.kt'),join(androidConsumer,'src/main/kotlin/com/likerts/installprobe/CheckoutFeedback.kt'));
  await writeFile(join(androidConsumer,'src/main/kotlin/com/likerts/installprobe/AdvancedOfflineProbe.kt'),`package com.likerts.installprobe\nimport com.likerts.sdk.AdvancedQuestions\nimport com.likerts.sdk.OfflineQueue\nval advancedOfflineTypes = listOf(AdvancedQuestions::class, OfflineQueue::class)\n`);
  await run(gradle,['--no-daemon','-p',androidConsumer,'assembleDebug'],root,env);
  const coordinate=join(maven,'com/likerts/likerts-android',version);
  for(const extension of ['aar','pom','module'])assert.ok((await stat(join(coordinate,`likerts-android-${version}.${extension}`))).size>0);
  checks.push({target:'android',passed:true,verification:'AAR/source JAR/POM/Gradle metadata in local Maven bundle; independent extracted-repository Android APK build without project dependency'});

  // Flutter packaging follows its independently verified package/native gate.
  const flutterHook=join(root,'scripts/check-flutter-release.mjs');
  {
    const result=JSON.parse(await run('node',[flutterHook,out,work,version]));
    artifacts.push(...result.artifacts);checks.push(result.check);
  }
  assert.equal(checks.length,5,'Every launch SDK must pass its clean install gate');
  for(const file of await allFiles(out))assert.ok(!/(^|\/)(\.env|credentials|node_modules)(\/|$)/.test(relative(out,file)));
  const manifest={version,schemaVersions:releaseSchemas,measuredAt:new Date().toISOString(),published:false,artifacts,checks,limitations:['Local install/artifact evidence only; no packages were uploaded to a registry.','Swift install consumer runs on macOS; OS-version, simulator and physical-device release gates remain separate.','React Native install probe checks TypeScript/Babel packaging, not native app device behavior.','Archives are versioned and checksummed; byte-for-byte reproducible builds and artifact signing are not claimed.']};
  await json(join(out,'manifest.json'),manifest);console.log(`SDK install gate passed for ${checks.map(c=>c.target).join(', ')}; artifacts at ${out}`);
  if(process.env.LIKERTS_KEEP_INSTALL_PROJECTS!=='1')await rm(work,{recursive:true});
}catch(error){console.error(`SDK release gate failed; inspect disposable consumers under ${work}`);throw error;}
