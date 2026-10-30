import { Buffer } from 'buffer';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import LightningFS from '@isomorphic-git/lightning-fs';
import * as fflate from 'fflate';

window.Buffer = Buffer;
window.BrowserGit = { git, http, LightningFS, fflate };
