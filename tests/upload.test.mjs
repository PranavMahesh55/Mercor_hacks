import test from 'node:test';
import assert from 'node:assert/strict';
import {validUploadUrl,validFileUri,validFileName} from '../lib/video-upload.ts';
test('upload proxy only accepts Google resumable upload destinations',()=>{
 assert.equal(validUploadUrl('https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=test'),true);
 for(const url of ['https://example.com/upload/x','http://generativelanguage.googleapis.com/upload/x','https://generativelanguage.googleapis.com.example.com/upload/x','https://user:secret@generativelanguage.googleapis.com/upload/x','https://generativelanguage.googleapis.com/v1beta/models'])assert.equal(validUploadUrl(url),false);
});
test('remote review accepts only canonical Google file references',()=>{
 assert.equal(validFileName('files/abc-123'),true);assert.equal(validFileName('files/../models'),false);
 assert.equal(validFileUri('https://generativelanguage.googleapis.com/v1beta/files/abc-123'),true);
 assert.equal(validFileUri('https://example.com/v1beta/files/abc'),false);
 assert.equal(validFileUri('https://generativelanguage.googleapis.com/v1beta/files/abc?key=secret'),false);
});
