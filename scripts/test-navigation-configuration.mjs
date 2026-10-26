import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const temporary=await mkdtemp(join(tmpdir(),'roam-nav-config-'));
try {
    const modules={};
    for(const name of ['configuration','bookmarkTree','management']) {
        const outfile=join(temporary,name+'.mjs');
        await build({entryPoints:[`src/navigation/${name}.ts`],outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
        modules[name]=await import(pathToFileURL(outfile));
    }
    const settingsOut=join(temporary,'settings.mjs');
    await build({entryPoints:['src/utils/settingsState.ts'],outfile:settingsOut,bundle:true,format:'esm',platform:'node',external:['obsidian'],logLevel:'silent'});
    const settings=await import(pathToFileURL(settingsOut));
    const c=modules.configuration;
    const config={journalName:'我的日志',journals:[{id:'paper',name:'论文工作',folder:'Projects/PAPER/Journal'},{id:'tools',name:'工具研发',folder:'Projects/Tools/Journal'}],links:[{id:'okr',name:'OKR',type:'note',target:'Projects/OKR#目标'},{id:'web',name:'团队网页',type:'web',target:'https://example.com/path?a=b'}]};
    const legacy={journalFolder:'Personal/Journal',initialRange:'recent-7',navigationViews:['journal-stream','page-stream'],recentFiles:['Notes/A.md'],recentFileTagsFilter:['work'],navigationSectionCollapsed:{bookmarks:true,recentFiles:false,recentTasks:true},outlinerScope:'off',preset:[{type:'folder',target:'Projects'}]};
    const migrated=settings.restoreDailyNoteSettings(legacy);
    for(const [key,value] of Object.entries(legacy))assert.deepEqual(migrated[key],value,`legacy field ${key} must survive`);
    assert.deepEqual(migrated.navigationConfiguration,c.defaultNavigationConfiguration());
    assert.equal(migrated.additionalJournalsCollapsed,true);
    const loaded=settings.restoreDailyNoteSettings({...legacy,navigationConfiguration:config,additionalJournalsCollapsed:false,bookmarkGroupCollapsed:{'root/ctime:100:0':true,bad:'yes'}});
    assert.deepEqual(loaded.navigationConfiguration,config);
    assert.deepEqual(loaded.bookmarkGroupCollapsed,{'root/ctime:100:0':true});
    assert.deepEqual(settings.restoreDailyNoteSettings(JSON.parse(JSON.stringify(loaded))),loaded,'configuration and collapse states must round-trip without losing existing settings');
    const before=structuredClone(config);
    const parsed=c.parseNavigationConfiguration(config);
    assert.deepEqual(parsed,config);
    assert.deepEqual(config,before,'configuration parsing must not mutate caller settings');
    const m=modules.management;
    const state={configuration:config,views:['journal-stream','page-stream','list-heading']};
    const source=structuredClone(state);
    const ref={kind:'journal',id:'paper'};
    const edited=m.editNavigation(state,ref,{...m.readNavigationDraft(state,ref),name:'Research',icon:'book-open',visible:false},'');
    assert.equal(edited.configuration.journals[0].folder,config.journals[0].folder);
    assert.equal(edited.configuration.journals[0].hidden,true);
    assert.equal(edited.configuration.journals[0].icon,'book-open');
    assert.deepEqual(state,source,'manual management must not mutate its source');
    assert.deepEqual(c.parseNavigationConfiguration(JSON.parse(JSON.stringify(edited.configuration))),edited.configuration);
    const moved=m.moveNavigation(edited,ref,1);
    assert.deepEqual(moved.configuration.journals.map(x=>x.id),['tools','paper']);
    assert.deepEqual(m.removeNavigation(moved,ref).configuration.journals.map(x=>x.id),['tools']);
    const added=m.editNavigation(state,null,{type:'web',name:'Docs',target:'https://example.org',icon:'globe',visible:true},'docs');
    assert.equal(added.configuration.links.at(-1).id,'docs');
    assert.equal(m.removeNavigation(added,{kind:'builtin',id:'page-stream'}).views.includes('page-stream'),false);
    const builtin=m.editNavigation(state,{kind:'builtin',id:'journal-stream'},{type:'builtin',name:'Diary',target:'',icon:'',visible:true},'');
    assert.equal(builtin.configuration.journalName,'Diary');
    assert.equal(builtin.configuration.journalIcon,undefined,'empty icon restores the built-in default');
    const override=m.editNavigation(state,{kind:'builtin',id:'page-stream'},{type:'builtin',name:'Pages',target:'',icon:'book',visible:true},'');
    assert.deepEqual(m.builtinAppearance(override.configuration,'page-stream'),{name:'Pages',icon:'book'});
    assert.throws(()=>m.editNavigation(state,ref,{type:'note',name:'Bad',target:'X',icon:'',visible:true},''));
    assert.throws(()=>m.editNavigation(state,null,{type:'journal',name:'Bad',target:'../outside',icon:'',visible:true},'bad'));
    assert.throws(()=>c.parseNavigationConfiguration({...config,journalIcon:'<svg>'}));
    assert.throws(()=>c.parseNavigationConfiguration({...config,links:[{...config.links[0],hidden:'yes'}]}));
    assert.throws(()=>c.parseNavigationConfiguration({...config,viewOverrides:{other:{name:'Bad'}}}));
    assert.equal(c.journalShortcutFolder(' Projects\\PAPER//./Journal/ '),'Projects/PAPER/Journal');
    const renamed=c.parseNavigationConfiguration({...config,journals:[{...config.journals[0],name:'新显示名'}]});
    assert.equal(renamed.journals[0].folder,config.journals[0].folder,'display-name changes must preserve the target path');
    for(const folder of ['/Users/feng','../outside','Project/../outside','C:\\outside','https://example.com','/','./']) {
        assert.throws(()=>c.journalShortcutFolder(folder),Error,folder);
    }
    for(const value of [null,[],3,{journals:{}},{journalName:''},{journals:[{id:'x',name:'A',folder:'A'},{id:'x',name:'B',folder:'B'}]},{journals:[{id:'x',name:'A',folder:'A//'},{id:'y',name:'B',folder:'A'}]}, {links:[{id:'x',name:'A',type:'web',target:'javascript:alert(1)'}]}, {links:[{id:'x',name:'A',type:'web',target:'obsidian://open'}]}, {links:[{id:'x',name:'A',type:'command',target:'execute'}]}, {links:[{id:'x',name:'A',type:'note',target:'file:///etc/passwd'}]}, {links:[{id:'x',name:'A',type:'note',target:'../secret'}]}]) {
        assert.throws(()=>c.parseNavigationConfiguration(value),Error);
    }
    assert.throws(()=>c.parseNavigationConfiguration({links:[{id:'x',name:'A',type:'note',target:'\\\\server\\share'}]}),Error);
    assert.deepEqual(c.restoreNavigationConfiguration(undefined),c.defaultNavigationConfiguration(),'old installs gain an empty optional configuration');
    assert.deepEqual(c.restoreNavigationConfiguration({links:'bad'}),c.defaultNavigationConfiguration());
    const first=c.defaultNavigationConfiguration();first.links.push(config.links[0]);
    assert.deepEqual(c.defaultNavigationConfiguration().links,[],'defaults must not share mutable collections');
    assert.deepEqual(c.restoreBookmarkGroupCollapsed({a:true,b:false,c:'true'}),{a:true,b:false});
    const items=[{type:'group',title:'项目',ctime:100,items:[{type:'file',path:'A.md'},{type:'group',title:'资料',items:[{type:'folder',path:'P/Journal'}]}]},{type:'group',title:'项目',ctime:200,items:[]},{type:'group',title:'同名',items:[]},{type:'group',title:'同名',items:[]},{type:'file',path:'missing.md'},{type:'file',path:'image.png'},{type:'file',path:'B.md',title:'自定义书签'}];
    const raw=structuredClone(items);
    const resolve=(path,type)=> type==='folder'&&path==='P/Journal'||type==='file'&&['A.md','B.md'].includes(path)?path:null;
    const tree=modules.bookmarkTree.buildBookmarkTree(items,resolve);
    assert.deepEqual(items,raw,'bookmark parsing must not mutate core data');
    assert.equal(tree.length,5);assert.equal(tree[0].children[1].children[0].path,'P/Journal');
    assert.equal(tree[4].label,'自定义书签');
    assert.notEqual(tree[2].key,tree[3].key,'same-name groups require distinct collapse identities');
    const reordering=modules.bookmarkTree.buildBookmarkTree([items[1],items[0]],resolve);
    assert.equal(reordering[1].key,tree[0].key,'core ctime should preserve group identity across reordering');
    const rename=modules.bookmarkTree.buildBookmarkTree([{...items[0],title:'新的组名'}],resolve);
    assert.equal(rename[0].key,tree[0].key,'core ctime should preserve group identity across renaming');
    console.log('PASS: configuration validation, migration defaults, names/paths, safe targets, nested bookmarks, identity and non-mutation');
} finally {await rm(temporary,{recursive:true,force:true});}
