<template><scroll-view scroll-y class="page"><text class="title">迁移旧网页日记和留言</text><text>在旧网页管理台导出本机 JSON，再选择该文件。日记和留言迁移后仅自己可见；原文件和原本机资料保留。旧活动报名及群聊身份不能直接变为云端成员，仍保留在备份文件中。</text><button @click="account">账号与登录</button>
<!-- #ifdef H5 --><button :disabled="busy" @click="chooseWeb">选择旧资料 JSON</button><!-- #endif -->
<!-- #ifdef APP-PLUS --><button :disabled="busy" @click="chooseNative">从系统文件选择</button><!-- #endif -->
<!-- #ifdef MP-WEIXIN --><button :disabled="busy" @click="chooseWechat">选择聊天文件</button><!-- #endif -->
<textarea v-model="source" :disabled="busy" :maxlength="5242880" placeholder="或粘贴旧资料 JSON" /><button :disabled="busy" @click="preview">解析资料</button><text>可迁移 {{rows.length}} 条；已完成 {{done}} 条</text><text>{{message}}</text><button :disabled="busy||!rows.length" @click="upload">迁移到当前账号的私密日记</button></scroll-view></template>
<script setup lang="ts">
import {accountSession} from '@/services/account';import {ref} from 'vue';import {chooseNativeText} from '@/services/files';import {parseLegacyNotes,importLegacyNotes,type LegacyNote} from '@/services/legacy-import';
const source=ref(''),rows=ref<LegacyNote[]>([]),done=ref(0),busy=ref(false),message=ref('');let parsedSource='';
function account(){uni.navigateTo({url:'/pages/account/account'});}function preview(){try{rows.value=parseLegacyNotes(source.value);parsedSource=source.value;done.value=0;message.value='已解析，尚未上传。';}catch(e:any){rows.value=[];message.value=e.message;}}
async function upload(){if(busy.value)return;const owner=accountSession()?.openid;if(!owner){message.value='请先登录统一账号';return;}const original=source.value;const snapshot=rows.value.map(row=>({...row}));if(source.value!==parsedSource){message.value='资料已变化，请重新解析';return;}const answer=await uni.showModal({title:'确认迁移到云端',content:'请确认这些日记和留言由你创建，并同意上传到当前账号。仅自己可见，不删除本机记录。'});if(!answer.confirm||busy.value)return;if(accountSession()?.openid!==owner||source.value!==original||parsedSource!==original){message.value='账号或资料已变化，请重新确认迁移';return;}busy.value=true;try{await importLegacyNotes(snapshot,(count)=>{done.value=count;});message.value='迁移完成，在云端日记页面查看。';}catch(e:any){message.value=e.message;}finally{busy.value=false;}}
async function chooseNative(){try{const text=await chooseNativeText();if(text!==null){source.value=text;preview();}}catch(e:any){message.value=e.message;}}
// #ifdef H5
function chooseWeb(){const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{const file=input.files?.[0];if(!file)return;if(file.size>5*1024*1024){message.value='文件最多5 MB';return;}try{source.value=await file.text();preview();}catch{message.value='读取失败';}};input.click();}
// #endif
// #ifdef MP-WEIXIN
function chooseWechat(){uni.chooseMessageFile({count:1,type:'file',extension:['json'],success:r=>{const file=r.tempFiles[0];if(file.size>5*1024*1024){message.value='文件最多5 MB';return;}uni.getFileSystemManager().readFile({filePath:file.path,encoding:'utf8',success:data=>{source.value=String(data.data);preview();},fail:()=>{message.value='读取失败';}});}});}
// #endif
</script><style scoped>.page{padding:15px;box-sizing:border-box;background:var(--he-color-background);color:var(--he-color-text);min-height:100vh}text{display:block;margin:10px 0}.title{font-size:18px}textarea{height:125px;background:var(--he-color-surface);width:100%;padding:10px;box-sizing:border-box}button{margin:10px 0}</style>
